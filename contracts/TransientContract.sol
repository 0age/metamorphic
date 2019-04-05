pragma solidity 0.5.6;


/**
 * @title Metamorphic Contract Factory Interface
 * @notice An interface to the factory contract that holds a reference to the
 * initialization code that will be used by the transient contract to deploy
 * the metamorphic contract.
 */
interface FactoryInterface {
  function getInitializationCode() external view returns (
    bytes memory initializationCode
  );
}


/**
 * @title Transient Contract
 * @author 0age
 * @notice This contract will create a metamorphic contract, or an upgradeable
 * contract that does not rely on a transparent proxy, when deployed using
 * CREATE2. Unlike with upgradeable transparent proxies, the state of a
 * metamorphic contract  will be wiped clean with each upgrade. The metamorphic
 * contract can also use a constructor if desired. With great power comes great
 * responsibility - implement appropriate controls and educate the users of your
 * contract if it will be interacted with!
 */
contract TransientContract {
  /**
   * @dev In the constructor, retrieve the initialization code for the new
   * version of the metamorphic contract, use it to deploy the metamorphic
   * contract while forwarding any value, and destroy the transient contract.
   */
  constructor() public payable {
    // retrieve the target implementation address from creator of this contract.
    bytes memory initCode = FactoryInterface(msg.sender).getInitializationCode();

    // set up a memory location for the address of the new metamorphic contract.
    address payable metamorphicContractAddress;

    // deploy the metamorphic contract address using the supplied init code.
    /* solhint-disable no-inline-assembly */
    assembly {
      let encoded_data := add(0x20, initCode) // load initialization code.
      let encoded_size := mload(initCode)     // load init code's length.
      metamorphicContractAddress := create(   // call CREATE with 3 arguments.
        callvalue,                            // forward any supplied endowment.
        encoded_data,                         // pass in initialization code.
        encoded_size                          // pass in init code's length.
      )
    } /* solhint-enable no-inline-assembly */

    // ensure that the metamorphic contract was successfully deployed.
    require(metamorphicContractAddress != address(0));

    // destroy transient contract and forward all value to metamorphic contract.
    selfdestruct(metamorphicContractAddress);
  }
}