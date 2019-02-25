pragma solidity 0.5.3;


/**
 * @title ContractOne
 * @author 0age
 * @notice This is the first implementation of an example metamorphic contract.
 */
contract ContractOne {
  uint256 private _x;

  /**
   * @dev test function
   * @return 1 once initialized (otherwise 0)
   */
  function test() external view returns (uint256 value) {
    return _x;
  }

  /**
   * @dev initialize function
   */
  function initialize() public {
    _x = 1;
  }

  /**
   * @dev destroy function, allows for the metamorphic contract to be redeployed
   */
  function destroy() public {
    selfdestruct(msg.sender);
  }
}
