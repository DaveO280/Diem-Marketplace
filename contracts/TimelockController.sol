// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TimelockController
 * @notice Simple timelock for sensitive operations
 * @dev Delays execution of owner functions by 24-48 hours
 */
abstract contract TimelockController is Ownable {
    
    uint256 public constant TIMELOCK_DURATION = 24 hours;
    
    struct Timelock {
        uint256 executeTime;
        bytes data;
        bool executed;
    }
    
    mapping(bytes32 => Timelock) public timelocks;
    
    event TimelockScheduled(bytes32 indexed id, uint256 executeTime);
    event TimelockExecuted(bytes32 indexed id);
    event TimelockCancelled(bytes32 indexed id);
    
    modifier onlyTimelock(bytes32 _id) {
        Timelock storage lock = timelocks[_id];
        require(lock.executeTime > 0, "Timelock not scheduled");
        require(block.timestamp >= lock.executeTime, "Timelock not ready");
        require(!lock.executed, "Timelock already executed");
        _;
        lock.executed = true;
        emit TimelockExecuted(_id);
    }
    
    /**
     * @notice Schedule a timelocked operation
     * @param _id Unique identifier for this operation
     * @param _data Encoded function call data
     */
    function _schedule(bytes32 _id, bytes memory _data) internal {
        require(timelocks[_id].executeTime == 0, "Already scheduled");
        
        uint256 executeTime = block.timestamp + TIMELOCK_DURATION;
        timelocks[_id] = Timelock({
            executeTime: executeTime,
            data: _data,
            executed: false
        });
        
        emit TimelockScheduled(_id, executeTime);
    }
    
    /**
     * @notice Cancel a scheduled timelock
     */
    function cancelTimelock(bytes32 _id) external onlyOwner {
        require(timelocks[_id].executeTime > 0, "Not scheduled");
        require(!timelocks[_id].executed, "Already executed");
        
        delete timelocks[_id];
        emit TimelockCancelled(_id);
    }
    
    /**
     * @notice Check if a timelock is ready
     */
    function isTimelockReady(bytes32 _id) external view returns (bool) {
        Timelock storage lock = timelocks[_id];
        return lock.executeTime > 0 && 
               block.timestamp >= lock.executeTime && 
               !lock.executed;
    }
}
