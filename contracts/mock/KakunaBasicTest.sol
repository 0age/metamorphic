pragma solidity 0.5.6;


contract KakunaBasicTest {
  string private constant TEST_STRING = "This is an example string for testing CODECOPY.";
  
  bool private _constructorTest;
  
  constructor() public {
    _constructorTest = true;
  }
   
  function constructorTest() public view returns (bool) {
    return _constructorTest;
  }   
  
  function codecopyTest() public pure returns (string memory) {
    return TEST_STRING;
  }
  
  function jumpTest() public view returns (bool) {
    if (uint160(gasleft()) % 2 == 0) {
      return _jumpTestOne();
    }
    
    return _jumpTestTwo();
  }
  
  function _jumpTestOne() internal pure returns (bool) {
    return false;
  }

  function _jumpTestTwo() internal pure returns (bool) {
    uint256 x;
    for (uint256 i; i < 10; i++) {
      x = i;
    }
    return true;
  }
}