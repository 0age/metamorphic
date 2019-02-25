pragma solidity 0.5.3;


/**
 * @title ContractTwo
 * @author 0age
 * @notice This is the second implementation of an example metamorphic contract.
 */
contract ContractTwo {
  event Paid(uint256 amount);

  uint256 private _x;

  /**
   * @dev Payable fallback function that emits an event logging the payment
   */
  function () external payable {
    if (msg.value > 0) {
      emit Paid(msg.value);
    }
  }

  /**
   * @dev Test function
   * @return 0 - storage is NOT carried over from the first implementation
   */
  function test() external view returns (uint256 value) {
    return _x;
  }
}
