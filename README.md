# Metamorphic

![GitHub](https://img.shields.io/github/license/0age/metamorphic.svg?colorB=brightgreen)
[![Build Status](https://travis-ci.org/0age/metamorphic.svg?branch=master)](https://travis-ci.org/0age/metamorphic)
[![standard-readme compliant](https://img.shields.io/badge/standard--readme-OK-green.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

> Metamorphic - A factory contract for creating metamorphic (i.e. redeployable) contracts.

This [factory contract](https://github.com/0age/metamorphic/blob/master/contracts/MetamorphicContractFactory.sol) creates *metamorphic contracts*, or contracts that can be redeployed with new code to the same address. It does so by deploying the metamorphic contract with fixed, non-deterministic initialization code via the CREATE2 opcode. This initalization code clones a given implementation contract and optionally initializes it in one operation. Once a contract undergoes metamorphosis, all existing storage will be deleted and any existing contract code will be replaced with the deployed contract code of the new implementation contract. There is also an [immutable create2 factory](https://github.com/0age/metamorphic/blob/master/contracts/ImmutableCreate2Factory.sol) that will not perform contract redeployments, thereby preventing metamorphism in contracts it deploys.

**DISCLAIMER: this implements a highly experimental feature / bug - be sure to implement appropriate controls on your metamorphic contracts and *educate the users of your contract* if it will be interacted with! CREATE2 will not be available on mainnet until (at least) block 7,280,000. This contract has not yet been fully tested or audited - proceed with caution and please share any exploits or optimizations you discover.**

Metamorphic Contract Factory on Ropsten: [0x00000080b6388c004fF9FD2C001B00F96fcDfFa3](https://ropsten.etherscan.io/address/0x00000080b6388c004ff9fd2c001b00f96fcdffa3)
Immutable Create2 Factory on Ropsten: [0x000000B64Df4e600F23000dbAEEB8c0052C88e73](https://ropsten.etherscan.io/address/0x000000b64df4e600f23000dbaeeb8c0052c88e73)

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

## API

Refer to contract source and natspec for documentation and usage information.

## Maintainers

[@0age](https://github.com/0age)

## Contribute

PRs accepted gladly - make sure the tests and linters pass.

## License

MIT © 2019 0age
