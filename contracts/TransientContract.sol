pragma solidity 0.5.3;


/**
 * @title Metamorphic Contract Factory Interface
 * @notice An interface to the factory contract that holds a reference to the
 * implementation contract that will be cloned by the transient contract when
 * creating the metamorphic contract.
 */
interface FactoryInterface {
  function getImplementation() external view returns (address implementation);
}


/**
 * @title Transient Contract
 * @author 0age
 * @notice This contract will create a metamorphic contract, or an upgradeable
 * contract that does not rely on a transparent proxy, when deployed using
 * CREATE2. Unlike with upgradeable transparent proxies, the state of a
 * metamorphic contract  will be wiped clean with each upgrade. With great power
 * comes great responsibility - implement appropriate controls and educate the
 * users of your contract if it will be interacted with!
 */
contract TransientContract {
  /**
   * @dev In the constructor, retrieve the address of the implementation
   * contract for the new version of the metamorphic contract, clone the
   * implementation, deploy the cloned code to a consistent address, and destroy
   * the transient contract, forwarding any value to the metamorphic contract.
   */
  constructor() public {
    // retrieve the target implementation address from creator of this contract.
    address implementation = FactoryInterface(msg.sender).getImplementation();

    // set up a memory location for the address of the new metamorphic contract.
    address payable metamorphicContractAddress;

    // clone target implementation's code to the metamorphic contract address.
    // see https://gist.github.com/holiman/069de8d056a531575d2b786df3345665
    /* solhint-disable no-inline-assembly */
    assembly {
      mstore(
        0,   // use the first memory location.
        or ( // place the implementation address into @mhswende's gnarly uint.
          0x5880730000000000000000000000000000000000000000803b80938091923cF3,
          mul(implementation, 0x1000000000000000000)
        )
      )
      // create the metamorphic contract using the clone of the target.
      metamorphicContractAddress := create(0, 0, 32)
    } /* solhint-enable no-inline-assembly */

    // ensure that the metamorphic contract was successfully deployed.
    require(metamorphicContractAddress != address(0));

    // destroy transient contract and forward all value to metamorphic contract.
    selfdestruct(metamorphicContractAddress);
  }
}
