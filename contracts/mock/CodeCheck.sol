pragma solidity 0.5.6;


/**
 * @title CodeCheck
 * @notice This contract checks the deployed runtime code of another contract.
 */
contract CodeCheck {
  function check(address target) public view returns (bytes memory code) {
    /* solhint-disable no-inline-assembly */
    assembly {
        // retrieve the size of the external code
        let size := extcodesize(target)
        // allocate output byte array
        code := mload(0x40)
        // new "memory end" including padding
        mstore(0x40, add(code, and(add(add(size, 0x20), 0x1f), not(0x1f))))
        // store length in memory
        mstore(code, size)
        // get the code using extcodecopy
        extcodecopy(target, add(code, 0x20), 0, size)
    } /* solhint-enable no-inline-assembly */
  }
}
