pragma solidity 0.5.6;


/**
 * @title ContractWithConstructor
 * @notice This is an implementation of an example metamorphic contract that has
 * a constructor function rather than an initializer function.
 */
contract ContractWithConstructor {
  uint256 private _x;

  /**
   * @dev constructor function
   */
  constructor() public {
    _x = 3;
  }

  /**
   * @dev test function
   * @return 3 (set in constructor)
   */
  function test() external view returns (uint256 value) {
    return _x;
  }

  /**
   * @dev destroy function, allows for the metamorphic contract to be redeployed
   */
  function destroy() public {
    selfdestruct(msg.sender);
  }
}
