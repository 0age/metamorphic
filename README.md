# Metamorphic

![GitHub](https://img.shields.io/github/license/0age/metamorphic.svg?colorB=brightgreen)
[![Build Status](https://travis-ci.org/0age/metamorphic.svg?branch=master)](https://travis-ci.org/0age/metamorphic)
[![standard-readme compliant](https://img.shields.io/badge/standard--readme-OK-green.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

> Metamorphic - A factory contract for creating metamorphic (i.e. redeployable) contracts.

This [factory contract](https://github.com/0age/metamorphic/blob/master/contracts/MetamorphicContractFactory.sol) creates *metamorphic contracts*, or contracts that can be redeployed with new code to the same address. It does so by deploying the metamorphic contract with fixed, non-deterministic initialization code via the CREATE2 opcode. This initalization code clones a given implementation contract and optionally initializes it in one operation. Once a contract undergoes metamorphosis, all existing storage will be deleted and any existing contract code will be replaced with the deployed contract code of the new implementation contract. Alternately, the factory can also create metamorphic contracts that utilize a constructor by deploying them with an intermediate [transient contract](https://github.com/0age/metamorphic/blob/master/contracts/TransientContract.sol) - otherwise an argument for atomically calling an initialization function after cloning an instance may be used. There is also an [immutable create2 factory](https://github.com/0age/metamorphic/blob/master/contracts/ImmutableCreate2Factory.sol) that will not perform contract redeployments, thereby preventing metamorphism of any contract it deploys *(although they may still deploy their own metamorphic contracts)*.

This repo also includes [Metapod](https://github.com/0age/metamorphic/blob/master/contracts/Metapod.sol), a factory for deploying "hardened" metamorphic contracts. *(Note that the provided version of Metapod uses a hard-coded address, used by the local test suite, throughout the contract that will all need to be altered it order to deploy to any other address.)* All contracts deployed through Metapod must include a prelude *(or initial snippet of code)* that allows it to destroy the contract and forward all funds to a dedicated vault contract. In order to insert the prelude into your contract, any stack items used by `JUMP` or `JUMPI` destinations, as well as by `CODECOPY` offsets, must first be modified. To try this out, there's a provided utility called [Kakuna](https://github.com/0age/metamorphic/blob/master/scripts/kakuna/kakuna.js), an **error-prone POC** for analyzing a contract and inserting a prelude.

**DISCLAIMER: this implements highly experimental features / bugs - be sure to implement appropriate controls on your metamorphic contracts and *educate the users of your contract* if it will be interacted with! These contracts have not yet been fully tested or audited - proceed with caution and please share any exploits or optimizations you discover.**

See [this medium post](https://medium.com/@0age/the-promise-and-the-peril-of-metamorphic-contracts-9eb8b8413c5e) for context.

Metamorphic Contract Factory on Mainnet: [0x00000000e82eb0431756271F0d00CFB143685e7B](https://etherscan.io/address/0x00000000e82eb0431756271f0d00cfb143685e7b)

Metamorphic Contract Factory on Ropsten: [0x00000000D63fB7385Ae38E7753F70e36d190abc2](https://ropsten.etherscan.io/address/0x00000000D63fB7385Ae38E7753F70e36d190abc2)

Immutable Create2 Factory on Mainnet: [0x000000000063b99B8036c31E91c64fC89bFf9ca7](https://etherscan.io/address/0x000000000063b99b8036c31e91c64fc89bff9ca7#code)

Immutable Create2 Factory on Ropsten: [0x000000B64Df4e600F23000dbAEEB8c0052C88e73](https://ropsten.etherscan.io/address/0x000000b64df4e600f23000dbaeeb8c0052c88e73)

Metapod on Mainnet: [0x00000000002B13cCcEC913420A21e4D11b2DCd3C](https://etherscan.io/address/0x00000000002b13cccec913420a21e4d11b2dcd3c)

Metapod on Ropsten: [0x0000000000f647BA29e4Dd009D2B7CADa21c1c68](https://ropsten.etherscan.io/address/0x0000000000f647ba29e4dd009d2b7cada21c1c68)

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [API](#api)
- [Maintainers](#maintainers)
- [Contribute](#contribute)
- [License](#license)

## Install
To install locally, you'll need Node.js 10+ and Yarn *(or npm)*. To get everything set up:
```sh
$ git clone https://github.com/0age/metamorphic.git
$ cd metamorphic
$ yarn install
$ yarn build
```

## Usage
In a new terminal window, start the testRPC, run tests, and tear down the testRPC *(you can do all of this at once via* `yarn all` *if you prefer)*:
```sh
$ yarn start
$ yarn test
$ yarn linter
$ yarn stop
```

To use Kakuna, first build the contracts, then run the following, replacing the contract name and prelude as desired (you'll need to get and insert the correct prelude for use with Metapod):
```sh
$ yarn kakuna ContractOne 0x4150
```

## API

**This documentation is incomplete - see the source code of each contract for a more complete summary.**

- [MetamorphicContractFactory.sol](#metamorphiccontractfactorysol)
- [ImmutableCreate2Factory.sol](#immutablecreate2factorysol)

### [MetamorphicContractFactory.sol](https://github.com/0age/metamorphic/blob/master/contracts/MetamorphicContractFactory.sol)

This contract creates metamorphic contracts, or contracts that can be redeployed with new code to the same address. It does so by deploying a contract with fixed, non-deterministic initialization code via the `CREATE2` opcode. This contract clones the implementation contract in its constructor. Once a contract undergoes metamorphosis, all existing storage will be deleted and any existing contract code will be replaced with the deployed contract code of the new implementation contract.

#### Events

```Solidity
event Metamorphosed(address metamorphicContract, address newImplementation);
```

#### Functions

- [deployMetamorphicContract](#deploymetamorphiccontract)
- [deployMetamorphicContractFromExistingImplementation](#deploymetamorphiccontractfromexistingimplementation)
- [getImplementation](#getimplementation)
- [getImplementationContractAddress](#getimplementationcontractaddress)
- [findMetamorphicContractAddress](#findmetamorphiccontractaddress)
- [getMetamorphicContractInitializationCode](#getmetamorphiccontractinitializationcode)
- [getMetamorphicContractInitializationCodeHash](#getmetamorphiccontractinitializationcodehash)


#### deployMetamorphicContract

Deploy a metamorphic contract by submitting a given salt or nonce along with the initialization code for the metamorphic contract, and optionally provide calldata for initializing the new metamorphic contract. To replace the contract, first selfdestruct the current contract, then call with the same salt value and new initialization code *(be aware that all existing state will be wiped from the existing contract)*. Also note that the first 20 bytes of the salt must match the calling address, which prevents contracts from being created by unintended parties.

```Solidity
function deployMetamorphicContract(
  bytes32 salt,
  bytes implementationContractInitializationCode,
  bytes metamorphicContractInitializationCalldata
) external payable returns (
  address metamorphicContractAddress
)
```

Arguments:

| Name        | Type           | Description  |
| ------------- |------------- | -----|
| salt | bytes32 | The nonce that will be passed into the CREATE2 call and thus will determine the resulant address of the metamorphic contract. | 
| implementationContractInitializationCode | bytes | The initialization code for the implementation contract for the metamorphic contract. It will be used to deploy a new contract that the metamorphic contract will then clone in its constructor. | 
| metamorphicContractInitializationCalldata | bytes | An optional data parameter that can be used to atomically initialize the metamorphic contract. | 

Returns: Address of the metamorphic contract that will be created.

#### deployMetamorphicContractFromExistingImplementation

Deploy a metamorphic contract by submitting a given salt or nonce along with the address of an existing implementation contract to clone, and optionally provide calldata for initializing the new metamorphic contract. To replace the contract, first selfdestruct the current contract, then call with the same salt value and a new implementation address *(be aware that all existing state will be wiped from the existing contract)*. Also note that the first 20 bytes of the salt must match the calling address, which prevents contracts from being created by unintended parties.

```Solidity
function deployMetamorphicContractFromExistingImplementation(
  bytes32 salt,
  address implementationContract,
  bytes metamorphicContractInitializationCalldata
) external payable returns (
  address metamorphicContractAddress
)
```

Arguments:

| Name        | Type           | Description  |
| ------------- |------------- | -----|
| salt | bytes32 | The nonce that will be passed into the CREATE2 call and thus will determine the resulant address of the metamorphic contract. | 
| implementationContract | address | The address of the existing implementation contract to clone. | 
| metamorphicContractInitializationCalldata | bytes | An optional data parameter that can be used to atomically initialize the metamorphic contract. | 

Returns: Address of the metamorphic contract that will be created.

#### getImplementation

View function for retrieving the address of the implementation contract to clone. Called by the constructor of each metamorphic contract.

```Solidity
function getImplementation() external view returns (address implementation)
```

#### getImplementationContractAddress

View function for retrieving the address of the current implementation contract of a given metamorphic contract, where the address of the contract is supplied as an argument. Be aware that the implementation contract has an independent state and may have been altered or selfdestructed from when it was last cloned by the metamorphic contract.

```Solidity
function getImplementationContractAddress(
  address metamorphicContractAddress
) external view returns (
  address implementationContractAddress
)
```

Arguments:

| Name        | Type           | Description  |
| ------------- |------------- | -----|
| metamorphicContractAddress | address | The address of the metamorphic contract. | 

Returns: Address of the corresponding implementation contract.

#### findMetamorphicContractAddress

Compute the address of the metamorphic contract that will be created upon submitting a given salt to the contract.

```Solidity
function findMetamorphicContractAddress(
  bytes32 salt
) external view returns (
  address metamorphicContractAddress
)
```

Arguments:

| Name        | Type           | Description  |
| ------------- |------------- | -----|
| salt | bytes32 | The nonce passed into CREATE2 by metamorphic contract. | 

Returns: Address of the corresponding metamorphic contract.

#### getMetamorphicContractInitializationCode

View function for retrieving the initialization code of metamorphic contracts for purposes of verification.

```Solidity
function getMetamorphicContractInitializationCode() external view returns (
  bytes metamorphicContractInitializationCode
)
```

#### getMetamorphicContractInitializationCodeHash

View function for retrieving the keccak256 hash of the initialization code of metamorphic contracts for purposes of verification.

```Solidity
function getMetamorphicContractInitializationCodeHash() external view returns (
  bytes32 metamorphicContractInitializationCodeHash
)
```

### [ImmutableCreate2Factory.sol](https://github.com/0age/metamorphic/blob/master/contracts/ImmutableCreate2Factory.sol)

This contract provides a safeCreate2 function that takes a salt value and a block of initialization code as arguments and passes them into inline assembly. The contract prevents redeploys by maintaining a mapping of all contracts that have already been deployed, and prevents frontrunning or other collisions by requiring that the first 20 bytes of the salt are equal to the address of the caller *(this can be bypassed by setting the first 20 bytes to the null address)*. There is also a view function that computes the address of the contract that will be created when submitting a given salt or nonce along with a given block of initialization code.

#### Functions

- [safeCreate2](#safecreate2)
- [findCreate2Address](#findcreate2address)
- [findCreate2AddressViaHash](#findcreate2addressviahash)
- [hasBeenDeployed](#hasbeendeployed)

#### safeCreate2

Create a contract using `CREATE2` by submitting a given salt or nonce along with the initialization code for the contract. Note that the first 20 bytes of the salt must match those of the calling address, which prevents contract creation events from being submitted by unintended parties.

```Solidity
function safeCreate2(
  bytes32 salt,
  bytes initializationCode
) external payable returns (
  address deploymentAddress
)
```

Arguments:

| Name        | Type           | Description  |
| ------------- |------------- | -----|
| salt | bytes32 | The nonce that will be passed into the CREATE2 call. | 
| initializationCode | bytes | The initialization code that will be passed into the CREATE2 call. | 

Returns: Address of the contract that will be created, or the null address if a contract already exists at that address.

#### findCreate2Address

Compute the address of the contract that will be created when submitting a given salt or nonce to the contract along with the contract's initialization code. The `CREATE2` address is computed in accordance with EIP-1014, and adheres to the formula therein of `keccak256( 0xff ++ address ++ salt ++ keccak256(init_code)))[12:]` when performing the computation. The computed address is then checked for any existing contract code - if so, the null address will be returned instead.

```Solidity
function findCreate2Address(
  bytes32 salt,
  bytes initCode
) external view returns (
  address deploymentAddress
)
```

Arguments:

| Name        | Type           | Description  |
| ------------- |------------- | -----|
| salt | bytes32 | The nonce passed into the CREATE2 address calculation. | 
| initCode | bytes | The contract initialization code to be used that will be passed into the CREATE2 address calculation. | 

Returns: Address of the contract that will be created, or the null address if a contract has already been deployed to that address.

#### findCreate2AddressViaHash

Compute the address of the contract that will be created when submitting a given salt or nonce to the contract along with the keccak256 hash of the contract's initialization code. The `CREATE2` address is computed in accordance with EIP-1014, and adheres to the formula therein of `keccak256( 0xff ++ address ++ salt ++ keccak256(init_code)))[12:]` when performing the computation. The computed address is then checked for any existing contract code - if so, the null address will be returned instead.

```Solidity
function findCreate2AddressViaHash(
  bytes32 salt,
  bytes32 initCodeHash
) external view returns (
  address deploymentAddress
)
```

Arguments:

| Name        | Type           | Description  |
| ------------- |------------- | -----|
| salt | bytes32 | The nonce passed into the CREATE2 address calculation. | 
| initCodeHash | bytes32 | The keccak256 hash of the initialization code that will be passed into the CREATE2 address calculation. | 

Returns: Address of the contract that will be created, or the null address if a contract has already been deployed to that address.

#### hasBeenDeployed

Determine if a contract has already been deployed by the factory to a given address.

```Solidity
function hasBeenDeployed(address deploymentAddress) external view returns (bool)
```

Arguments:

| Name        | Type           | Description  |
| ------------- |------------- | -----|
| deploymentAddress | address | The contract address to check. | 

Returns: True if the contract has been deployed, false otherwise.

## Maintainers

[@0age](https://github.com/0age)

## Contribute

PRs accepted gladly - make sure the tests and linters pass.

## License

MIT © 2019 0age
