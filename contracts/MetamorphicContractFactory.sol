pragma solidity 0.5.3;


/**
 * @title Metamorphic Contract Factory
 * @author 0age
 * @notice This contract creates metamorphic contracts, or contracts that can be
 * redeployed with new code to the same address. It does so by first deploying a
 * transient contract with fixed, non-deterministic initialization code via the
 * CREATE2 opcode. This transient contract then creates the metamorphic contract
 * by cloning a given implementation contract and deploying via CREATE, then
 * immediately self-destructs. Once a contract undergoes metamorphosis, all
 * existing storage will be deleted and any existing contract code will be
 * replaced with the deployed contract code of the new implementation contract.
 * @dev CREATE2 will not be available on mainnet until (at least) block
 * 7,280,000. This contract has not yet been fully tested or audited - proceed
 * with caution and please share any exploits or optimizations you discover.
 */
contract MetamorphicContractFactory {
  // store the initialization code for transient contracts.
  bytes private _transientContractInitializationCode;

  // store the hash of the initialization code for transient contracts as well.
  bytes32 private _transientContractInitializationCodeHash;

  // maintain a mapping of transient contracts to metamorphic implementations.
  mapping(address => address) private _implementations;

  /**
   * @dev In the constructor, set up the initialization code for transient
   * contracts as well as the keccak256 hash of the given initialization code.
   * @param transientContractInitializationCode bytes The initialization code
   * that will be used to deploy each transient contract, which in turn deploy
   * each metamorphic contract.
   */
  constructor(bytes memory transientContractInitializationCode) public {
    // assign the supplied initialization code for the transient contract.
    _transientContractInitializationCode = transientContractInitializationCode;

    // calculate and assign the keccak256 hash of the initialization code.
    _transientContractInitializationCodeHash = keccak256(
      abi.encodePacked(
        transientContractInitializationCode
      )
    );
  }

  /* solhint-disable function-max-lines */
  /**
   * @dev Deploy a metamorphic contract by submitting a given salt or nonce
   * along with the initialization code for the metamorphic contract, and
   * optionally provide calldata for initializing the new metamorphic contract.
   * To replace the contract, first selfdestruct the current contract, then call
   * with the same salt value and new initialization code (be aware that all
   * existing state will be wiped from the existing contract). Also note that
   * the first 20 bytes of the salt must match the calling address, which
   * prevents contracts from being created by unintended parties.
   * @param salt bytes32 The nonce that will be passed into the CREATE2 call and
   * thus will determine the resulant address of the metamorphic contract.
   * @param implementationContractInitializationCode bytes The initialization
   * code for the implementation contract for the metamorphic contract. It will
   * be used to deploy a new contract that the transient contract will then
   * clone and use to create the metamorphic contract.
   * @param metamorphicContractInitializationCalldata bytes An optional data
   * parameter that can be used to atomically initialize the metamorphic
   * contract.
   * @return Address of the metamorphic contract that will be created.
   */
  function deployMetamorphicContract(
    bytes32 salt,
    bytes calldata implementationContractInitializationCode,
    bytes calldata metamorphicContractInitializationCalldata
  ) external payable containsCaller(salt) returns (
    address metamorphicContractAddress
  ) {
    // move implementation init code and initialization calldata to memory.
    bytes memory implInitCode = implementationContractInitializationCode;
    bytes memory data = metamorphicContractInitializationCalldata;

    // move the initialization code from storage to memory.
    bytes memory initCode = _transientContractInitializationCode;

    // declare variable to verify successful transient contract deployment.
    address deployedTransientContract;

    // determine the address of the transient contract.
    address transientContractAddress = _getTransientContractAddress(salt);

    // declare a variable for the address of the implementation contract.
    address implementation;

    // load implementation init code and length, then deploy via CREATE.
    /* solhint-disable no-inline-assembly */
    assembly {
      let encoded_data := add(0x20, implInitCode) // load initialization code.
      let encoded_size := mload(implInitCode)     // load init code's length.
      implementation := create(               // call CREATE with 3 arguments.
        0,                                    // do not forward any endowment.
        encoded_data,                         // pass in initialization code.
        encoded_size                          // pass in init code's length.
      )
    } /* solhint-enable no-inline-assembly */

    require(implementation != address(0), "Could not deploy implementation.");

    // store the implementation to be retrieved by the transient contract.
    _implementations[transientContractAddress] = implementation;

    // determine the address of the metamorphic contract.
    metamorphicContractAddress = _getMetamorphicContractAddress(
      transientContractAddress
    );

    // load transient contract data and length of data, then deploy via CREATE2.
    /* solhint-disable no-inline-assembly */
    assembly {
      let encoded_data := add(0x20, initCode) // load initialization code.
      let encoded_size := mload(initCode)     // load the init code's length.
      deployedTransientContract := create2(   // call CREATE2 with 4 arguments.
        0,                                    // do not forward any endowment.
        encoded_data,                         // pass in initialization code.
        encoded_size,                         // pass in init code's length.
        salt                                  // pass in the salt value.
      )
    } /* solhint-enable no-inline-assembly */

    // ensure that the contracts were successfully deployed.
    require(
      deployedTransientContract == transientContractAddress,
      "Failed to deploy the new metamorphic contract."
    );

    // initialize the new metamorphic contract if any data or value is provided.
    if (data.length > 0 || msg.value > 0) {
      /* solhint-disable avoid-call-value */
      (bool success,) = metamorphicContractAddress.call.value(msg.value)(data);
      /* solhint-enable avoid-call-value */

      require(success, "Failed to initialize the new metamorphic contract.");
    }
  } /* solhint-enable function-max-lines */

  /**
   * @dev Deploy a metamorphic contract by submitting a given salt or nonce
   * along with the address of an existing implementation contract to clone, and
   * optionally provide calldata for initializing the new metamorphic contract.
   * To replace the contract, first selfdestruct the current contract, then call
   * with the same salt value and a new implementation address (be aware that
   * all existing state will be wiped from the existing contract). Also note
   * that the first 20 bytes of the salt must match the calling address, which
   * prevents contracts from being created by unintended parties.
   * @param salt bytes32 The nonce that will be passed into the CREATE2 call and
   * thus will determine the resulant address of the metamorphic contract.
   * @param implementationContract address The address of the existing
   * implementation contract to clone.
   * @param metamorphicContractInitializationCalldata bytes An optional data
   * parameter that can be used to atomically initialize the metamorphic
   * contract.
   * @return Address of the metamorphic contract that will be created.
   */
  function deployMetamorphicContractFromExistingImplementation(
    bytes32 salt,
    address implementationContract,
    bytes calldata metamorphicContractInitializationCalldata
  ) external payable containsCaller(salt) returns (
    address metamorphicContractAddress
  ) {
    // move initialization calldata to memory.
    bytes memory data = metamorphicContractInitializationCalldata;

    // move the initialization code from storage to memory.
    bytes memory initCode = _transientContractInitializationCode;

    // declare variable to verify successful transient contract deployment.
    address deployedTransientContract;

    // determine the address of the transient contract.
    address transientContractAddress = _getTransientContractAddress(salt);

    // determine the address of the metamorphic contract.
    metamorphicContractAddress = _getMetamorphicContractAddress(
      transientContractAddress
    );

    // store the implementation to be retrieved by the transient contract.
    _implementations[transientContractAddress] = implementationContract;

    // using inline assembly: load data and length of data, then call CREATE2.
    /* solhint-disable no-inline-assembly */
    assembly {
      let encoded_data := add(0x20, initCode) // load initialization code.
      let encoded_size := mload(initCode)     // load the init code's length.
      deployedTransientContract := create2(   // call CREATE2 with 4 arguments.
        0,                                    // do not forward any endowment.
        encoded_data,                         // pass in initialization code.
        encoded_size,                         // pass in init code's length.
        salt                                  // pass in the salt value.
      )
    } /* solhint-enable no-inline-assembly */

    // ensure that the contracts were successfully deployed.
    require(
      deployedTransientContract == transientContractAddress,
      "Failed to deploy the new metamorphic contract."
    );

    // initialize the new metamorphic contract if any data or value is provided.
    if (data.length > 0 || msg.value > 0) {
      /* solhint-disable avoid-call-value */
      (bool success,) = metamorphicContractAddress.call.value(msg.value)(data);
      /* solhint-enable avoid-call-value */

      require(success, "Failed to initialize the new metamorphic contract.");
    }
  }

  /**
   * @dev View function for retrieving the address of the implementation
   * contract to clone. Called by the constructor of each transient contract.
   */
  function getImplementation() external view returns (address implementation) {
    return _implementations[msg.sender];
  }

  /**
   * @dev Compute the address of the transient contract that will be created
   * upon submitting a given salt to the contract.
   * @param salt bytes32 The nonce passed into CREATE2 by transient contract.
   * @return Address of the corresponding transient contract.
   */
  function findTransientContractAddress(
    bytes32 salt
  ) external view returns (address transientContractAddress) {
    // determine the address where the transient contract will be deployed.
    transientContractAddress = _getTransientContractAddress(salt);
  }

  /**
   * @dev Compute the address of the metamorphic contract that will be created
   * by the transient contract upon submitting a given salt to the contract.
   * @param salt bytes32 The nonce passed into CREATE2 by transient contract.
   * @return Address of the corresponding metamorphic contract.
   */
  function findMetamorphicContractAddress(
    bytes32 salt
  ) external view returns (address metamorphicContractAddress) {
    // determine the address of the metamorphic contract.
    metamorphicContractAddress = _getMetamorphicContractAddress(
      _getTransientContractAddress(salt)
    );
  }

  /**
   * @dev View function for retrieving the initialization code of transient
   * contracts for purposes of verification.
   */
  function getTransientContractInitializationCode() external view returns (
    bytes memory transientContractInitializationCode
  ) {
    return _transientContractInitializationCode;
  }

  /**
   * @dev View function for retrieving the keccak256 hash of the initialization
   * code of transient contracts for purposes of verification.
   */
  function getTransientContractInitializationCodeHash() external view returns (
    bytes32 transientContractInitializationCodeHash
  ) {
    return _transientContractInitializationCodeHash;
  }

  /**
   * @dev Internal view function for calculating a transient contract address
   * given a particular salt.
   */
  function _getTransientContractAddress(
    bytes32 salt
  ) internal view returns (address) {
    // determine the address of the transient contract.
    return address(
      uint160(                      // downcast to match the address type.
        uint256(                    // convert to uint to truncate upper digits.
          keccak256(                // compute the CREATE2 hash using 4 inputs.
            abi.encodePacked(       // pack all inputs to the hash together.
              hex"ff",              // start with 0xff to distinguish from RLP.
              address(this),        // this contract will be the caller.
              salt,                 // pass in the supplied salt value.
              _transientContractInitializationCodeHash // supply init code hash.
            )
          )
        )
      )
    );
  }

  /**
   * @dev Internal view function for calculating a metamorphic contract address
   * given a particular salt.
   */
  function _getMetamorphicContractAddress(
    address transientContractAddress
  ) internal pure returns (address payable) {
    // determine the address of the metamorphic contract.
    return address(
      uint160(                          // downcast to match the address type.
        uint256(                        // set to uint to truncate upper digits.
          keccak256(                    // compute CREATE hash via RLP encoding.
            abi.encodePacked(           // pack all inputs to the hash together.
              byte(0xd6),               // first RLP byte.
              byte(0x94),               // second RLP byte.
              transientContractAddress, // the transient contract is the sender.
              byte(0x01)                // nonce begins at 1 for contracts.
            )
          )
        )
      )
    );
  }

  /**
   * @dev Modifier to ensure that the first 20 bytes of a submitted salt match
   * those of the calling account. This provides protection against the salt
   * being stolen by frontrunners or other attackers.
   * @param salt bytes32 The salt value to check against the calling address.
   */
  modifier containsCaller(bytes32 salt) {
    // prevent contract submissions from being stolen from tx.pool by requiring
    // that the first 20 bytes of the submitted salt match msg.sender.
    require(
      address(bytes20(salt)) == msg.sender,
      "Invalid salt - first 20 bytes of the salt must match calling address."
    );
    _;
  }
}
