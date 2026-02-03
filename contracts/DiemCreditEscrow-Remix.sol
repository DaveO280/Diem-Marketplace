// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title DiemCreditEscrow (Remix-Compatible Single File)
 * @notice Escrow contract for DIEM API credit marketplace
 * @dev Flattened for Remix IDE - deploy DiemCreditEscrow with USDC address
 */

// ============ IERC20 Interface ============
interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

// ============ DiemCreditEscrow (All-in-One) ============
contract DiemCreditEscrow {

    // ============ Ownable ============
    address private _owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(_owner == msg.sender, "Not owner");
        _;
    }

    function owner() public view returns (address) {
        return _owner;
    }

    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "Zero address");
        _owner = newOwner;
        emit OwnershipTransferred(_owner, newOwner);
    }

    // ============ ReentrancyGuard ============
    uint256 private _reentrancyStatus = 1;

    modifier nonReentrant() {
        require(_reentrancyStatus == 1, "Reentrant call");
        _reentrancyStatus = 2;
        _;
        _reentrancyStatus = 1;
    }

    // ============ Core Contract ============
    IERC20 public immutable usdc;

    uint256 public platformFeeBps = 100;      // 1%
    uint256 public unusedPenaltyBps = 500;    // 5%
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public defaultDuration = 24 hours;

    enum Status { Pending, Funded, Active, Completed, Disputed, Refunded }

    struct Escrow {
        address provider;
        address consumer;
        uint256 amount;
        uint256 diemLimit;
        uint256 startTime;
        uint256 endTime;
        Status status;
        bytes32 apiKeyHash;
        uint256 reportedUsage;
        bool providerConfirmed;
        bool consumerConfirmed;
    }

    mapping(bytes32 => Escrow) public escrows;
    mapping(address => uint256) public providerBalances;
    mapping(address => uint256) public consumerNonces;
    uint256 public accumulatedPlatformFees;
    bytes32[] public allEscrowIds;

    // Pause state
    bool public paused;
    uint256 public unpauseScheduledTime;

    // Fee update timelock
    uint256 public pendingPlatformFeeBps;
    uint256 public pendingUnusedPenaltyBps;
    uint256 public feeUpdateScheduledTime;

    // Events
    event EscrowCreated(bytes32 indexed escrowId, address indexed provider, address indexed consumer, uint256 amount, uint256 diemLimit);
    event EscrowFunded(bytes32 indexed escrowId, uint256 amount);
    event KeyDelivered(bytes32 indexed escrowId, bytes32 apiKeyHash);
    event UsageReported(bytes32 indexed escrowId, uint256 usage);
    event EscrowCompleted(bytes32 indexed escrowId, uint256 providerAmount, uint256 platformFee, uint256 penaltyAmount);
    event EscrowDisputed(bytes32 indexed escrowId, address initiator);
    event EscrowRefunded(bytes32 indexed escrowId, uint256 amount);
    event ProviderWithdrawal(address indexed provider, uint256 amount);
    event PlatformFeeWithdrawal(uint256 amount);
    event KeyVerified(bytes32 indexed escrowId, address indexed consumer);
    event FeeUpdateScheduled(uint256 platformFeeBps, uint256 unusedPenaltyBps, uint256 executeTime);
    event FeesUpdated(uint256 platformFeeBps, uint256 unusedPenaltyBps);
    event FeeUpdateCancelled();
    event Paused(address account);
    event UnpauseScheduled(uint256 unpauseTime);
    event Unpaused();

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
        require(!paused, "Paused");
        _;
    }

    constructor(address _usdc) {
        require(_usdc != address(0), "Invalid USDC");
        usdc = IERC20(_usdc);
        _owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

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
            msg.sender, _provider, _diemLimit, block.timestamp, consumerNonces[msg.sender]++
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
    }

    function fundEscrow(bytes32 _escrowId)
        external
        nonReentrant
        onlyConsumer(_escrowId)
        inStatus(_escrowId, Status.Pending)
    {
        Escrow storage escrow = escrows[_escrowId];
        require(usdc.transferFrom(msg.sender, address(this), escrow.amount), "Transfer failed");

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

    function verifyApiKey(bytes32 _escrowId, string calldata _apiKey) public view returns (bool) {
        Escrow storage escrow = escrows[_escrowId];
        require(escrow.status != Status.Pending, "Not funded");
        return keccak256(abi.encodePacked(_apiKey)) == escrow.apiKeyHash;
    }

    function confirmKeyReceipt(bytes32 _escrowId, string calldata _apiKey)
        external
        onlyConsumer(_escrowId)
        inStatus(_escrowId, Status.Active)
    {
        require(verifyApiKey(_escrowId, _apiKey), "Invalid key");
        emit KeyVerified(_escrowId, msg.sender);
    }

    function reportUsage(bytes32 _escrowId, uint256 _usage) external inStatus(_escrowId, Status.Active) {
        Escrow storage escrow = escrows[_escrowId];
        require(_usage <= escrow.diemLimit, "Usage exceeds limit");
        require(block.timestamp <= escrow.endTime + 1 hours, "Window closed");

        if (msg.sender == escrow.consumer) {
            escrow.reportedUsage = _usage;
            escrow.consumerConfirmed = true;
        } else if (msg.sender == escrow.provider) {
            require(escrow.consumerConfirmed, "Consumer first");
            require(escrow.reportedUsage == _usage, "Mismatch");
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

        uint256 usedAmount = (escrow.amount * escrow.reportedUsage) / escrow.diemLimit;
        uint256 unusedAmount = escrow.amount - usedAmount;
        uint256 platformFee = (usedAmount * platformFeeBps) / BPS_DENOMINATOR;
        uint256 penaltyAmount = (unusedAmount * unusedPenaltyBps) / BPS_DENOMINATOR;
        uint256 providerAmount = usedAmount - platformFee + penaltyAmount;
        uint256 consumerRefund = unusedAmount - penaltyAmount;

        accumulatedPlatformFees += platformFee;
        escrow.status = Status.Completed;
        providerBalances[escrow.provider] += providerAmount;

        if (consumerRefund > 0) {
            require(usdc.transfer(escrow.consumer, consumerRefund), "Refund failed");
        }

        emit EscrowCompleted(_escrowId, providerAmount, platformFee, penaltyAmount);
    }

    function raiseDispute(bytes32 _escrowId) external inStatus(_escrowId, Status.Active) {
        Escrow storage escrow = escrows[_escrowId];
        require(msg.sender == escrow.consumer || msg.sender == escrow.provider, "Not authorized");
        require(block.timestamp <= escrow.endTime + 24 hours, "Window closed");
        escrow.status = Status.Disputed;
        emit EscrowDisputed(_escrowId, msg.sender);
    }

    function resolveDispute(bytes32 _escrowId, uint256 _providerAmount, uint256 _consumerAmount)
        external
        onlyOwner
        inStatus(_escrowId, Status.Disputed)
    {
        Escrow storage escrow = escrows[_escrowId];
        require(_providerAmount + _consumerAmount <= escrow.amount, "Exceeds escrow");

        escrow.status = Status.Completed;
        if (_providerAmount > 0) providerBalances[escrow.provider] += _providerAmount;
        if (_consumerAmount > 0) require(usdc.transfer(escrow.consumer, _consumerAmount), "Transfer failed");

        emit EscrowCompleted(_escrowId, _providerAmount, 0, 0);
    }

    function refundExpired(bytes32 _escrowId) external nonReentrant inStatus(_escrowId, Status.Funded) {
        Escrow storage escrow = escrows[_escrowId];
        require(block.timestamp > escrow.startTime + 1 hours, "Not expired");
        escrow.status = Status.Refunded;
        require(usdc.transfer(escrow.consumer, escrow.amount), "Refund failed");
        emit EscrowRefunded(_escrowId, escrow.amount);
    }

    function autoComplete(bytes32 _escrowId) external nonReentrant inStatus(_escrowId, Status.Active) {
        Escrow storage escrow = escrows[_escrowId];
        require(block.timestamp > escrow.endTime + 2 hours, "Not expired");
        require(!escrow.consumerConfirmed, "Consumer reported");

        escrow.reportedUsage = escrow.diemLimit;
        escrow.consumerConfirmed = true;
        escrow.providerConfirmed = true;
        _completeEscrow(_escrowId);
    }

    function withdrawProviderBalance() external nonReentrant {
        uint256 amount = providerBalances[msg.sender];
        require(amount > 0, "No balance");
        providerBalances[msg.sender] = 0;
        require(usdc.transfer(msg.sender, amount), "Transfer failed");
        emit ProviderWithdrawal(msg.sender, amount);
    }

    function withdrawPlatformFees() external onlyOwner nonReentrant {
        uint256 amount = accumulatedPlatformFees;
        require(amount > 0, "No fees");
        accumulatedPlatformFees = 0;
        require(usdc.transfer(_owner, amount), "Transfer failed");
        emit PlatformFeeWithdrawal(amount);
    }

    // Fee timelock
    function scheduleFeeUpdate(uint256 _platformFeeBps, uint256 _unusedPenaltyBps) external onlyOwner {
        require(_platformFeeBps <= 500 && _unusedPenaltyBps <= 2000, "Fee too high");
        require(feeUpdateScheduledTime == 0, "Already scheduled");
        pendingPlatformFeeBps = _platformFeeBps;
        pendingUnusedPenaltyBps = _unusedPenaltyBps;
        feeUpdateScheduledTime = block.timestamp + 24 hours;
        emit FeeUpdateScheduled(_platformFeeBps, _unusedPenaltyBps, feeUpdateScheduledTime);
    }

    function executeFeeUpdate() external {
        require(feeUpdateScheduledTime > 0 && block.timestamp >= feeUpdateScheduledTime, "Not ready");
        platformFeeBps = pendingPlatformFeeBps;
        unusedPenaltyBps = pendingUnusedPenaltyBps;
        feeUpdateScheduledTime = 0;
        emit FeesUpdated(platformFeeBps, unusedPenaltyBps);
    }

    function cancelFeeUpdate() external onlyOwner {
        require(feeUpdateScheduledTime > 0, "Not scheduled");
        feeUpdateScheduledTime = 0;
        emit FeeUpdateCancelled();
    }

    // Pause
    function pause() external onlyOwner {
        paused = true;
        unpauseScheduledTime = 0;
        emit Paused(msg.sender);
    }

    function scheduleUnpause() external onlyOwner {
        require(paused && unpauseScheduledTime == 0, "Invalid state");
        unpauseScheduledTime = block.timestamp + 24 hours;
        emit UnpauseScheduled(unpauseScheduledTime);
    }

    function unpause() external {
        require(paused && unpauseScheduledTime > 0 && block.timestamp >= unpauseScheduledTime, "Not ready");
        paused = false;
        unpauseScheduledTime = 0;
        emit Unpaused();
    }

    // View functions
    function getEscrow(bytes32 _escrowId) external view returns (Escrow memory) {
        return escrows[_escrowId];
    }

    function getEscrowCount() external view returns (uint256) {
        return allEscrowIds.length;
    }

    function calculateDistribution(uint256 _totalAmount, uint256 _diemLimit, uint256 _usage)
        external view returns (uint256 providerAmount, uint256 consumerRefund, uint256 platformFee, uint256 penaltyAmount)
    {
        uint256 usedAmount = (_totalAmount * _usage) / _diemLimit;
        uint256 unusedAmount = _totalAmount - usedAmount;
        platformFee = (usedAmount * platformFeeBps) / BPS_DENOMINATOR;
        penaltyAmount = (unusedAmount * unusedPenaltyBps) / BPS_DENOMINATOR;
        providerAmount = usedAmount - platformFee + penaltyAmount;
        consumerRefund = unusedAmount - penaltyAmount;
    }
}
