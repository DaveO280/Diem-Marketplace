// SPDX-License-Identifier: MIT
// DACN DiemCreditEscrow - Remix Ready Version
// Copy this entire file into Remix IDE
// Compile with Solidity 0.8.19
// Deploy to Base Sepolia

pragma solidity ^0.8.19;

// ============ OpenZeppelin Contracts (Flattened) ============

// OpenZeppelin Ownable
abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }
}

abstract contract Ownable is Context {
    address private _owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor() {
        _transferOwnership(_msgSender());
    }

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    function owner() public view virtual returns (address) {
        return _owner;
    }

    function _checkOwner() internal view virtual {
        require(owner() == _msgSender(), "Ownable: caller is not the owner");
    }

    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    function transferOwnership(address newOwner) public virtual onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is the zero address");
        _transferOwnership(newOwner);
    }

    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}

// OpenZeppelin ReentrancyGuard
abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    constructor() {
        _status = _NOT_ENTERED;
    }

    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() private {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
    }

    function _nonReentrantAfter() private {
        _status = _NOT_ENTERED;
    }
}

// OpenZeppelin IERC20
interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

// ============ DACN Escrow Contract ============

/**
 * @title DiemCreditEscrow
 * @notice Escrow contract for DIEM API credit marketplace
 * @dev Designed for Base network with USDC
 */
contract DiemCreditEscrow is ReentrancyGuard, Ownable {
    
    IERC20 public immutable usdc;
    
    // Fee configuration (in basis points)
    uint256 public platformFeeBps = 100;      // 1%
    uint256 public unusedPenaltyBps = 500;    // 5%
    uint256 public constant BPS_DENOMINATOR = 10000;
    
    // Default escrow duration (24 hours = DIEM epoch)
    uint256 public defaultDuration = 24 hours;
    
    // Accumulated fees tracking
    uint256 public accumulatedPlatformFees;
    
    // Timelock variables
    uint256 public pendingPlatformFeeBps;
    uint256 public pendingUnusedPenaltyBps;
    uint256 public feeUpdateScheduledTime;
    
    // Pause variables
    bool public paused = false;
    uint256 public unpauseScheduledTime = 0;
    
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
        uint256 startTime;
        uint256 endTime;
        Status status;
        bytes32 apiKeyHash;       // Hash of API key identifier
        uint256 reportedUsage;    // Amount actually used (in cents)
        bool providerConfirmed;
        bool consumerConfirmed;
    }
    
    mapping(bytes32 => Escrow) public escrows;
    mapping(address => uint256) public providerBalances;  // Withdrawable balance
    mapping(address => uint256) public consumerNonces;    // For unique escrow IDs
    
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
    event KeyVerified(bytes32 indexed escrowId, address indexed consumer);
    event UsageReported(bytes32 indexed escrowId, uint256 usage);
    event EscrowCompleted(
        bytes32 indexed escrowId,
        uint256 providerAmount,
        uint256 platformFee,
        uint256 penaltyAmount
    );
    event EscrowDisputed(bytes32 indexed escrowId, address initiator);
    event EscrowRefunded(bytes32 indexed escrowId, uint256 amount);
    event EscrowCancelled(bytes32 indexed escrowId, address indexed consumer, uint256 amount);
    event ProviderWithdrawal(address indexed provider, uint256 amount);
    event PlatformFeeWithdrawal(uint256 amount);
    event FeeUpdateScheduled(uint256 platformFeeBps, uint256 unusedPenaltyBps, uint256 executeTime);
    event FeesUpdated(uint256 platformFeeBps, uint256 unusedPenaltyBps);
    event FeeUpdateCancelled();
    event Paused(address account);
    event UnpauseScheduled(uint256 unpauseTime);
    event Unpaused();
    
    // Modifiers
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
    
    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }
    
    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }
    
    // ============ Core Functions ============
    
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
            startTime: 0,
            endTime: 0,
            status: Status.Pending,
            apiKeyHash: bytes32(0),
            reportedUsage: 0,
            providerConfirmed: false,
            consumerConfirmed: false
        });
        
        allEscrowIds.push(escrowId);
        
        emit EscrowCreated(escrowId, _provider, msg.sender, _amount, _diemLimit);
        
        return escrowId;
    }
    
    function fundEscrow(bytes32 _escrowId) 
        external 
        nonReentrant 
        onlyConsumer(_escrowId)
        inStatus(_escrowId, Status.Pending) 
    {
        Escrow storage escrow = escrows[_escrowId];
        
        require(
            usdc.transferFrom(msg.sender, address(this), escrow.amount),
            "USDC transfer failed"
        );
        
        escrow.startTime = block.timestamp;
        escrow.endTime = block.timestamp + defaultDuration;
        escrow.status = Status.Funded;
        
        emit EscrowFunded(_escrowId, escrow.amount);
    }
    
    function deliverKey(bytes32 _escrowId, bytes32 _apiKeyHash)
        external
        onlyProvider(_escrowId)
        inStatus(_escrowId, Status.Funded)
    {
        require(_apiKeyHash != bytes32(0), "Invalid key hash");
        
        Escrow storage escrow = escrows[_escrowId];
        escrow.apiKeyHash = _apiKeyHash;
        escrow.status = Status.Active;
        
        emit KeyDelivered(_escrowId, _apiKeyHash);
    }
    
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
    
    function confirmKeyReceipt(bytes32 _escrowId, string calldata _apiKey)
        external
        onlyConsumer(_escrowId)
        inStatus(_escrowId, Status.Active)
    {
        require(verifyApiKey(_escrowId, _apiKey), "Invalid API key");
        emit KeyVerified(_escrowId, msg.sender);
    }
    
    function reportUsage(bytes32 _escrowId, uint256 _usage)
        external
        inStatus(_escrowId, Status.Active)
    {
        Escrow storage escrow = escrows[_escrowId];
        require(_usage <= escrow.diemLimit, "Usage exceeds limit");
        require(block.timestamp <= escrow.endTime + 1 hours, "Reporting window closed");
        
        if (msg.sender == escrow.consumer) {
            escrow.reportedUsage = _usage;
            escrow.consumerConfirmed = true;
        } else if (msg.sender == escrow.provider) {
            require(escrow.consumerConfirmed, "Consumer must report first");
            require(escrow.reportedUsage == _usage, "Usage mismatch");
            escrow.providerConfirmed = true;
        } else {
            revert("Not authorized");
        }
        
        emit UsageReported(_escrowId, _usage);
        
        if (escrow.consumerConfirmed && escrow.providerConfirmed) {
            _completeEscrow(_escrowId);
        }
    }
    
    function _completeEscrow(bytes32 _escrowId) internal {
        Escrow storage escrow = escrows[_escrowId];
        require(escrow.status == Status.Active, "Not active");
        
        uint256 usage = escrow.reportedUsage;
        uint256 diemLimit = escrow.diemLimit;
        uint256 totalAmount = escrow.amount;
        
        uint256 usedAmount = (totalAmount * usage) / diemLimit;
        uint256 unusedAmount = totalAmount - usedAmount;
        
        uint256 platformFee = (usedAmount * platformFeeBps) / BPS_DENOMINATOR;
        accumulatedPlatformFees += platformFee;
        
        uint256 penaltyAmount = (unusedAmount * unusedPenaltyBps) / BPS_DENOMINATOR;
        
        uint256 providerAmount = usedAmount - platformFee + penaltyAmount;
        uint256 consumerRefund = unusedAmount - penaltyAmount;
        
        escrow.status = Status.Completed;
        
        providerBalances[escrow.provider] += providerAmount;
        
        if (consumerRefund > 0) {
            require(usdc.transfer(escrow.consumer, consumerRefund), "Refund failed");
        }
        
        emit EscrowCompleted(_escrowId, providerAmount, platformFee, penaltyAmount);
    }
    
    // ============ Cancel Function ============
    
    function cancelEscrow(bytes32 _escrowId)
        external
        nonReentrant
        onlyConsumer(_escrowId)
        inStatus(_escrowId, Status.Funded)
    {
        Escrow storage escrow = escrows[_escrowId];
        
        escrow.status = Status.Refunded;
        
        require(usdc.transfer(escrow.consumer, escrow.amount), "Refund failed");
        
        emit EscrowCancelled(_escrowId, msg.sender, escrow.amount);
    }
    
    // ============ Dispute Functions ============
    
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
    
    // ============ Auto-Functions ============
    
    function refundExpired(bytes32 _escrowId)
        external
        nonReentrant
        inStatus(_escrowId, Status.Funded)
    {
        Escrow storage escrow = escrows[_escrowId];
        require(block.timestamp > escrow.startTime + 1 hours, "Not expired");
        
        escrow.status = Status.Refunded;
        
        require(usdc.transfer(escrow.consumer, escrow.amount), "Refund failed");
        
        emit EscrowRefunded(_escrowId, escrow.amount);
    }
    
    function autoComplete(bytes32 _escrowId)
        external
        nonReentrant
        inStatus(_escrowId, Status.Active)
    {
        Escrow storage escrow = escrows[_escrowId];
        require(block.timestamp > escrow.endTime + 2 hours, "Not expired");
        require(!escrow.consumerConfirmed, "Consumer reported");
        
        escrow.reportedUsage = escrow.diemLimit;
        escrow.consumerConfirmed = true;
        escrow.providerConfirmed = true;
        
        _completeEscrow(_escrowId);
    }
    
    // ============ Withdrawal Functions ============
    
    function withdrawProviderBalance() external nonReentrant {
        uint256 amount = providerBalances[msg.sender];
        require(amount > 0, "No balance");
        
        providerBalances[msg.sender] = 0;
        
        require(usdc.transfer(msg.sender, amount), "Transfer failed");
        
        emit ProviderWithdrawal(msg.sender, amount);
    }
    
    function withdrawPlatformFees() external onlyOwner nonReentrant {
        uint256 amount = accumulatedPlatformFees;
        require(amount > 0, "No fees to withdraw");
        
        accumulatedPlatformFees = 0;
        
        require(usdc.transfer(owner(), amount), "Fee transfer failed");
        
        emit PlatformFeeWithdrawal(amount);
    }
    
    // ============ Timelocked Fee Updates ============
    
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
    
    function executeFeeUpdate() external {
        require(feeUpdateScheduledTime > 0, "No update scheduled");
        require(block.timestamp >= feeUpdateScheduledTime, "Too early");
        
        platformFeeBps = pendingPlatformFeeBps;
        unusedPenaltyBps = pendingUnusedPenaltyBps;
        feeUpdateScheduledTime = 0;
        
        emit FeesUpdated(platformFeeBps, unusedPenaltyBps);
    }
    
    function cancelFeeUpdate() external onlyOwner {
        require(feeUpdateScheduledTime > 0, "No update scheduled");
        feeUpdateScheduledTime = 0;
        emit FeeUpdateCancelled();
    }
    
    // ============ Pause Functions ============
    
    function pause() external onlyOwner {
        paused = true;
        unpauseScheduledTime = 0;
        emit Paused(msg.sender);
    }
    
    function scheduleUnpause() external onlyOwner {
        require(paused, "Not paused");
        require(unpauseScheduledTime == 0, "Unpause already scheduled");
        unpauseScheduledTime = block.timestamp + 24 hours;
        emit UnpauseScheduled(unpauseScheduledTime);
    }
    
    function unpause() external {
        require(paused, "Not paused");
        require(unpauseScheduledTime > 0, "Unpause not scheduled");
        require(block.timestamp >= unpauseScheduledTime, "Too early");
        
        paused = false;
        unpauseScheduledTime = 0;
        emit Unpaused();
    }
    
    // ============ View Functions ============
    
    function getEscrow(bytes32 _escrowId) external view returns (Escrow memory) {
        return escrows[_escrowId];
    }
    
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

// ============ Deployment Instructions ============
/*
1. Go to https://remix.ethereum.org
2. Create new file: DiemCreditEscrow.sol
3. Paste this entire file
4. Compile with:
   - Compiler: 0.8.19
   - EVM Version: London
5. Deploy to Base Sepolia:
   - Environment: Injected Provider (Metamask)
   - Network: Base Sepolia
   - Constructor argument: 0x036CbD53842c5426634e7929541eC2318f3dCF7e (USDC)
6. Save the deployed contract address!

USDC on Base Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
Verify on: https://sepolia.basescan.org
*/
