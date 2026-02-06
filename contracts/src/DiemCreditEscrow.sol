// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./TimelockController.sol";

/**
 * @title DiemCreditEscrow
 * @notice Escrow contract for DIEM API credit marketplace
 * @dev Designed for Base network with USDC
 */
contract DiemCreditEscrow is ReentrancyGuard, TimelockController {
    
    IERC20 public immutable usdc;
    
    // Fee configuration (in basis points)
    uint256 public platformFeeBps = 100;      // 1%
    uint256 public unusedPenaltyBps = 500;    // 5%
    uint256 public constant BPS_DENOMINATOR = 10000;
    
    // Default escrow duration (24 hours = DIEM epoch)
    uint256 public defaultDuration = 24 hours;

    // Max USDC per escrow (6 decimals); limits exposure (e.g. 10_000 USDC)
    uint256 public maxEscrowAmount = 10_000 * 1e6;

    // Delay before completion can be executed after both parties confirm (dispute window)
    uint256 public completionDelay = 1 hours;
    
    enum Status { 
        Pending,      // Created, waiting for funding
        Funded,       // Consumer funded, provider should create key
        Active,       // Key delivered, in use
        Completed,    // Usage confirmed, funds released
        Disputed,     // Dispute raised
        Refunded      // Refunded to consumer
    }
    
    struct Escrow {
        address provider;
        address consumer;
        uint256 amount;           // Total USDC amount (6 decimals)
        uint256 diemLimit;        // DIEM credit limit (in cents, 1 DIEM = 100)
        uint256 duration;         // Duration in seconds (used when funded)
        uint256 startTime;
        uint256 endTime;
        Status status;
        bytes32 apiKeyHash;       // Hash of API key identifier
        uint256 reportedUsage;    // Amount actually used (in cents)
        bool providerConfirmed;
        bool consumerConfirmed;
        uint256 completionUnlockTime; // When both confirmed, earliest time executeCompletion can run (dispute window)
    }
    
    mapping(bytes32 => Escrow) public escrows;
    mapping(address => uint256) public providerBalances;  // Withdrawable balance
    mapping(address => uint256) public consumerNonces;    // For unique escrow IDs
    
    uint256 public accumulatedPlatformFees;  // Track fees for withdrawal
    
    bytes32[] public allEscrowIds;
    
    // Events
    event EscrowCreated(
        bytes32 indexed escrowId,
        address indexed provider,
        address indexed consumer,
        uint256 amount,
        uint256 diemLimit
    );
    
    event EscrowFunded(bytes32 indexed escrowId, uint256 amount);
    event KeyDelivered(bytes32 indexed escrowId, bytes32 apiKeyHash);
    event UsageReported(bytes32 indexed escrowId, uint256 usage);
    event EscrowCompleted(
        bytes32 indexed escrowId,
        uint256 providerAmount,
        uint256 platformFee,
        uint256 penaltyAmount
    );
    event EscrowDisputed(bytes32 indexed escrowId, address initiator);
    event EscrowRefunded(bytes32 indexed escrowId, uint256 amount);
    event ProviderWithdrawal(address indexed provider, uint256 amount);
    event PlatformFeeWithdrawal(uint256 amount);
    
    // Key verification events
    event KeyVerified(bytes32 indexed escrowId, address indexed consumer);
    
    // Fee update events
    event FeeUpdateScheduled(uint256 platformFeeBps, uint256 unusedPenaltyBps, uint256 executeTime);
    event FeesUpdated(uint256 platformFeeBps, uint256 unusedPenaltyBps);
    event FeeUpdateCancelled();
    
    modifier onlyProvider(bytes32 _escrowId) {
        require(escrows[_escrowId].provider == msg.sender, "Not provider");
        _;
    }
    
    modifier onlyConsumer(bytes32 _escrowId) {
        require(escrows[_escrowId].consumer == msg.sender, "Not consumer");
        _;
    }
    
    modifier inStatus(bytes32 _escrowId, Status _status) {
        require(escrows[_escrowId].status == _status, "Wrong status");
        _;
    }
    
    constructor(address _usdc) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
    }
    
    /**
     * @notice Create a new escrow agreement
     * @param _provider Address of DIEM provider
     * @param _diemLimit Amount of DIEM credit requested (in cents)
     * @param _amount USDC amount to escrow (including fees)
     * @param _duration Duration of escrow in seconds (0 = default 24h)
     * @return escrowId Unique identifier for this escrow
     */
    function createEscrow(
        address _provider,
        uint256 _diemLimit,
        uint256 _amount,
        uint256 _duration
    ) external whenNotPaused returns (bytes32 escrowId) {
        require(_provider != address(0), "Invalid provider");
        require(_provider != msg.sender, "Cannot escrow with self");
        require(_diemLimit > 0, "DIEM limit must be > 0");
        require(_amount > 0, "Amount must be > 0");
        require(_amount <= maxEscrowAmount, "Amount exceeds max escrow cap");
        
        uint256 duration = _duration == 0 ? defaultDuration : _duration;
        escrowId = keccak256(abi.encodePacked(
            msg.sender,
            _provider,
            _diemLimit,
            block.timestamp,
            consumerNonces[msg.sender]++
        ));
        
        escrows[escrowId] = Escrow({
            provider: _provider,
            consumer: msg.sender,
            amount: _amount,
            diemLimit: _diemLimit,
            duration: duration,
            startTime: 0,  // Set on funding
            endTime: 0,
            status: Status.Pending,
            apiKeyHash: bytes32(0),
            reportedUsage: 0,
            providerConfirmed: false,
            consumerConfirmed: false,
            completionUnlockTime: 0
        });
        
        allEscrowIds.push(escrowId);
        
        emit EscrowCreated(escrowId, _provider, msg.sender, _amount, _diemLimit);
        
        return escrowId;
    }
    
    /**
     * @notice Fund an escrow with USDC
     * @param _escrowId Escrow to fund
     */
    function fundEscrow(bytes32 _escrowId) 
        external 
        whenNotPaused
        nonReentrant 
        onlyConsumer(_escrowId)
        inStatus(_escrowId, Status.Pending) 
    {
        Escrow storage escrow = escrows[_escrowId];
        
        // Transfer USDC from consumer
        require(
            usdc.transferFrom(msg.sender, address(this), escrow.amount),
            "USDC transfer failed"
        );
        
        escrow.startTime = block.timestamp;
        escrow.endTime = block.timestamp + escrow.duration;
        escrow.status = Status.Funded;
        
        emit EscrowFunded(_escrowId, escrow.amount);
    }
    
    /**
     * @notice Provider confirms and delivers API key hash
     * @param _escrowId Escrow to deliver
     * @param _apiKeyHash Hash of the API key (for verification)
     */
    function deliverKey(bytes32 _escrowId, bytes32 _apiKeyHash)
        external
        whenNotPaused
        onlyProvider(_escrowId)
        inStatus(_escrowId, Status.Funded)
    {
        require(_apiKeyHash != bytes32(0), "Invalid key hash");
        
        Escrow storage escrow = escrows[_escrowId];
        escrow.apiKeyHash = _apiKeyHash;
        escrow.status = Status.Active;
        
        emit KeyDelivered(_escrowId, _apiKeyHash);
    }
    
    /**
     * @notice Verify an API key matches the stored hash
     * @param _escrowId Escrow to verify
     * @param _apiKey API key to verify (keccak256 hash is compared)
     * @return valid True if the key matches the stored hash
     */
    function verifyApiKey(bytes32 _escrowId, string calldata _apiKey) 
        external 
        view 
        returns (bool valid) 
    {
        Escrow storage escrow = escrows[_escrowId];
        require(escrow.status != Status.Pending, "Escrow not funded");
        
        bytes32 providedHash = keccak256(abi.encodePacked(_apiKey));
        return providedHash == escrow.apiKeyHash;
    }
    
    /**
     * @notice Consumer confirms they received the API key. Key is never submitted on-chain (only hash is stored).
     * @param _escrowId Escrow ID
     */
    function confirmKeyReceipt(bytes32 _escrowId)
        external
        onlyConsumer(_escrowId)
        inStatus(_escrowId, Status.Active)
    {
        emit KeyVerified(_escrowId, msg.sender);
    }
    
    /**
     * @notice Report usage for an escrow (honest oracle model)
     * @param _escrowId Escrow to report
     * @param _usage Amount of DIEM actually used (in cents)
     */
    function reportUsage(bytes32 _escrowId, uint256 _usage)
        external
        whenNotPaused
        nonReentrant
        inStatus(_escrowId, Status.Active)
    {
        Escrow storage escrow = escrows[_escrowId];
        require(_usage <= escrow.diemLimit, "Usage exceeds limit");
        require(block.timestamp <= escrow.endTime + 1 hours, "Reporting window closed");
        
        if (msg.sender == escrow.consumer) {
            escrow.reportedUsage = _usage;
            escrow.consumerConfirmed = true;
        } else if (msg.sender == escrow.provider) {
            // Provider can confirm consumer's reported usage
            require(escrow.consumerConfirmed, "Consumer must report first");
            require(escrow.reportedUsage == _usage, "Usage mismatch");
            escrow.providerConfirmed = true;
        } else {
            revert("Not authorized");
        }
        
        emit UsageReported(_escrowId, _usage);
        
        // When both confirmed, set completion unlock time (dispute window); do not complete immediately
        if (escrow.consumerConfirmed && escrow.providerConfirmed && escrow.completionUnlockTime == 0) {
            escrow.completionUnlockTime = block.timestamp + completionDelay;
        }
    }

    /**
     * @notice Execute completion after dispute window (anyone can call after unlock)
     */
    function executeCompletion(bytes32 _escrowId)
        external
        whenNotPaused
        nonReentrant
    {
        Escrow storage escrow = escrows[_escrowId];
        require(escrow.status == Status.Active, "Not active");
        require(escrow.consumerConfirmed && escrow.providerConfirmed, "Both must confirm first");
        require(escrow.completionUnlockTime > 0 && block.timestamp >= escrow.completionUnlockTime, "Dispute window not over");
        _completeEscrow(_escrowId);
    }
    
    /**
     * @notice Complete escrow and distribute funds
     * @param _escrowId Escrow to complete
     */
    function _completeEscrow(bytes32 _escrowId) internal {
        Escrow storage escrow = escrows[_escrowId];
        require(escrow.status == Status.Active, "Not active");
        
        uint256 usage = escrow.reportedUsage;
        uint256 diemLimit = escrow.diemLimit;
        uint256 totalAmount = escrow.amount;
        
        // Calculate distribution
        // Provider gets: (usage / diemLimit) * amount * (1 - platformFee)
        // But we need to account for the unused penalty
        
        uint256 usedAmount = (totalAmount * usage) / diemLimit;
        uint256 unusedAmount = totalAmount - usedAmount;
        
        // Platform fee on the used portion
        uint256 platformFee = (usedAmount * platformFeeBps) / BPS_DENOMINATOR;
        accumulatedPlatformFees += platformFee;
        
        // Unused penalty (goes to provider as compensation)
        uint256 penaltyAmount = (unusedAmount * unusedPenaltyBps) / BPS_DENOMINATOR;
        
        // Provider receives: usedAmount - platformFee + penaltyAmount
        uint256 providerAmount = usedAmount - platformFee + penaltyAmount;
        
        // Consumer refund: unusedAmount - penaltyAmount
        uint256 consumerRefund = unusedAmount - penaltyAmount;
        
        escrow.status = Status.Completed;
        
        // Credit provider (they withdraw later)
        providerBalances[escrow.provider] += providerAmount;
        
        // Transfer refund to consumer
        if (consumerRefund > 0) {
            require(usdc.transfer(escrow.consumer, consumerRefund), "Refund failed");
        }
        
        emit EscrowCompleted(_escrowId, providerAmount, platformFee, penaltyAmount);
    }
    
    /**
     * @notice Raise a dispute
     * @param _escrowId Escrow to dispute
     */
    function raiseDispute(bytes32 _escrowId)
        external
        inStatus(_escrowId, Status.Active)
    {
        Escrow storage escrow = escrows[_escrowId];
        require(
            msg.sender == escrow.consumer || msg.sender == escrow.provider,
            "Not authorized"
        );
        require(block.timestamp <= escrow.endTime + 24 hours, "Dispute window closed");
        
        escrow.status = Status.Disputed;
        
        emit EscrowDisputed(_escrowId, msg.sender);
    }
    
    /**
     * @notice Owner resolves dispute (manual for MVP)
     * @param _escrowId Escrow to resolve
     * @param _providerAmount Amount to send to provider
     * @param _consumerAmount Amount to refund to consumer
     */
    function resolveDispute(
        bytes32 _escrowId,
        uint256 _providerAmount,
        uint256 _consumerAmount
    ) external onlyOwner inStatus(_escrowId, Status.Disputed) {
        Escrow storage escrow = escrows[_escrowId];
        
        require(
            _providerAmount + _consumerAmount <= escrow.amount,
            "Amounts exceed escrow"
        );
        
        escrow.status = Status.Completed;
        
        if (_providerAmount > 0) {
            providerBalances[escrow.provider] += _providerAmount;
        }
        
        if (_consumerAmount > 0) {
            require(usdc.transfer(escrow.consumer, _consumerAmount), "Refund failed");
        }
        
        emit EscrowCompleted(_escrowId, _providerAmount, 0, 0);
    }
    
    /**
     * @notice Auto-refund if provider never delivers key
     * @param _escrowId Escrow to refund
     */
    function refundExpired(bytes32 _escrowId)
        external
        whenNotPaused
        nonReentrant
        inStatus(_escrowId, Status.Funded)
    {
        Escrow storage escrow = escrows[_escrowId];
        require(block.timestamp > escrow.startTime + 1 hours, "Not expired");
        
        escrow.status = Status.Refunded;
        
        require(usdc.transfer(escrow.consumer, escrow.amount), "Refund failed");
        
        emit EscrowRefunded(_escrowId, escrow.amount);
    }
    
    /**
     * @notice Auto-complete if consumer never reports
     * @param _escrowId Escrow to auto-complete
     */
    function autoComplete(bytes32 _escrowId)
        external
        whenNotPaused
        nonReentrant
        inStatus(_escrowId, Status.Active)
    {
        Escrow storage escrow = escrows[_escrowId];
        require(block.timestamp > escrow.endTime + 2 hours, "Not expired");
        require(!escrow.consumerConfirmed, "Consumer reported");
        
        // Assume full usage if consumer never reports
        escrow.reportedUsage = escrow.diemLimit;
        escrow.consumerConfirmed = true;
        escrow.providerConfirmed = true;
        
        _completeEscrow(_escrowId);
    }
    
    /**
     * @notice Provider withdraws their accumulated balance
     */
    function withdrawProviderBalance() external nonReentrant {
        uint256 amount = providerBalances[msg.sender];
        require(amount > 0, "No balance");
        
        providerBalances[msg.sender] = 0;
        
        require(usdc.transfer(msg.sender, amount), "Transfer failed");
        
        emit ProviderWithdrawal(msg.sender, amount);
    }
    
    /**
     * @notice Owner withdraws accumulated platform fees
     */
    function withdrawPlatformFees() external onlyOwner nonReentrant {
        uint256 amount = accumulatedPlatformFees;
        require(amount > 0, "No fees to withdraw");
        
        accumulatedPlatformFees = 0;
        
        require(usdc.transfer(owner(), amount), "Fee transfer failed");
        
        emit PlatformFeeWithdrawal(amount);
    }
    
    // Timelocked fee updates
    uint256 public pendingPlatformFeeBps;
    uint256 public pendingUnusedPenaltyBps;
    uint256 public feeUpdateScheduledTime;
    
    /**
     * @notice Schedule a fee update (timelocked for 24 hours)
     */
    function scheduleFeeUpdate(uint256 _platformFeeBps, uint256 _unusedPenaltyBps) 
        external 
        onlyOwner 
    {
        require(_platformFeeBps <= 500, "Platform fee max 5%");
        require(_unusedPenaltyBps <= 2000, "Penalty max 20%");
        require(feeUpdateScheduledTime == 0, "Update already scheduled");
        
        pendingPlatformFeeBps = _platformFeeBps;
        pendingUnusedPenaltyBps = _unusedPenaltyBps;
        feeUpdateScheduledTime = block.timestamp + 24 hours;
        
        emit FeeUpdateScheduled(_platformFeeBps, _unusedPenaltyBps, feeUpdateScheduledTime);
    }
    
    /**
     * @notice Execute scheduled fee update after 24 hour delay
     */
    function executeFeeUpdate() external {
        require(feeUpdateScheduledTime > 0, "No update scheduled");
        require(block.timestamp >= feeUpdateScheduledTime, "Too early");
        
        platformFeeBps = pendingPlatformFeeBps;
        unusedPenaltyBps = pendingUnusedPenaltyBps;
        feeUpdateScheduledTime = 0;
        
        emit FeesUpdated(platformFeeBps, unusedPenaltyBps);
    }
    
    /**
     * @notice Cancel scheduled fee update
     */
    function cancelFeeUpdate() external onlyOwner {
        require(feeUpdateScheduledTime > 0, "No update scheduled");
        feeUpdateScheduledTime = 0;
        emit FeeUpdateCancelled();
    }
    
    // Emergency pause
    bool public paused = false;
    uint256 public unpauseScheduledTime = 0;
    
    event Paused(address account);
    event UnpauseScheduled(uint256 unpauseTime);
    event Unpaused();
    
    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    modifier whenPaused() {
        require(paused, "Contract not paused");
        _;
    }
    
    /**
     * @notice Emergency pause - can be called immediately by owner
     */
    function pause() external onlyOwner {
        paused = true;
        unpauseScheduledTime = 0; // Clear any scheduled unpause
        emit Paused(msg.sender);
    }
    
    /**
     * @notice Schedule unpause (24 hour timelock)
     */
    function scheduleUnpause() external onlyOwner {
        require(paused, "Not paused");
        require(unpauseScheduledTime == 0, "Unpause already scheduled");
        unpauseScheduledTime = block.timestamp + 24 hours;
        emit UnpauseScheduled(unpauseScheduledTime);
    }
    
    /**
     * @notice Execute unpause after timelock
     */
    function unpause() external {
        require(paused, "Not paused");
        require(unpauseScheduledTime > 0, "Unpause not scheduled");
        require(block.timestamp >= unpauseScheduledTime, "Too early");
        
        paused = false;
        unpauseScheduledTime = 0;
        emit Unpaused();
    }

    /**
     * @notice Set max USDC per escrow (owner only; limits exposure)
     */
    function setMaxEscrowAmount(uint256 _max) external onlyOwner {
        require(_max >= 1e6, "Max must be at least 1 USDC");
        maxEscrowAmount = _max;
    }

    /**
     * @notice Set completion delay / dispute window (owner only)
     */
    function setCompletionDelay(uint256 _delay) external onlyOwner {
        completionDelay = _delay;
    }

    /**
     * @notice Emergency refund: when paused, owner can refund escrow to consumer (kill switch)
     */
    function emergencyRefund(bytes32 _escrowId) external onlyOwner whenPaused nonReentrant {
        Escrow storage escrow = escrows[_escrowId];
        require(escrow.status == Status.Funded || escrow.status == Status.Active, "Invalid status");
        require(escrow.amount > 0, "No funds");
        escrow.status = Status.Refunded;
        require(usdc.transfer(escrow.consumer, escrow.amount), "Refund failed");
        emit EscrowRefunded(_escrowId, escrow.amount);
    }
    
    /**
     * @notice Get escrow details
     */
    function getEscrow(bytes32 _escrowId) external view returns (Escrow memory) {
        return escrows[_escrowId];
    }
    
    /**
     * @notice Calculate expected distribution
     */
    function calculateDistribution(
        uint256 _totalAmount,
        uint256 _diemLimit,
        uint256 _usage
    ) external view returns (
        uint256 providerAmount,
        uint256 consumerRefund,
        uint256 platformFee,
        uint256 penaltyAmount
    ) {
        uint256 usedAmount = (_totalAmount * _usage) / _diemLimit;
        uint256 unusedAmount = _totalAmount - usedAmount;
        
        platformFee = (usedAmount * platformFeeBps) / BPS_DENOMINATOR;
        penaltyAmount = (unusedAmount * unusedPenaltyBps) / BPS_DENOMINATOR;
        
        providerAmount = usedAmount - platformFee + penaltyAmount;
        consumerRefund = unusedAmount - penaltyAmount;
        
        return (providerAmount, consumerRefund, platformFee, penaltyAmount);
    }
}
