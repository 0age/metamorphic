var assert = require('assert')
var fs = require('fs')
var util = require('ethereumjs-util')

var kakuna = require('../kakuna/kakuna.js')

const MetamorphicContractFactoryArtifact = require('../../build/contracts/MetamorphicContractFactory.json')
const TransientContractArtifact = require('../../build/contracts/TransientContract.json')
const ImmutableCreate2FactoryArtifact = require('../../build/contracts/ImmutableCreate2Factory.json')
const ContractOneArtifact = require('../../build/contracts/ContractOne.json')
const ContractTwoArtifact = require('../../build/contracts/ContractTwo.json')
const ContractWithConstructorArtifact = require('../../build/contracts/ContractWithConstructor.json')
const CodeCheckArtifact = require('../../build/contracts/CodeCheck.json')
const MetapodArtifact = require('../../build/contracts/Metapod.json')
const KakunaBasicTestArtifact = require('../../build/contracts/KakunaBasicTest.json')
const KakunaBasicTestWithPreludeArtifact = require('../../build/kakuna/KakunaBasicTest.json')

const MetamorphicContractBytecode = '0x5860208158601c335a63aaf10f428752fa158151803b80938091923cf3'

module.exports = {test: async function (provider, testingContext) {
  var web3 = provider
  let passed = 0
  let failed = 0
  let gasUsage = {}
  console.log('running tests...')

  // get available addresses and assign them to various roles
  const addresses = await web3.eth.getAccounts()
  if (addresses.length < 1) {
    console.log('cannot find enough addresses to run tests!')
    process.exit(1)
  }

  const originalAddress = addresses[0]

  async function send(
    title,
    instance,
    method,
    args,
    from,
    value,
    gas,
    gasPrice,
    shouldSucceed,
    assertionCallback
  ) {
    let succeeded = true
    receipt = await instance.methods[method](...args).send({
      from: from,
      value: value,
      gas: gas,
      gasPrice: gasPrice
    }).catch(error => {
      //console.error(error)
      succeeded = false
    })

    if (succeeded !== shouldSucceed) {
      return false
    } else if (!shouldSucceed) {
      return true
    }

    assert.ok(receipt.status)

    let assertionsPassed
    try {
      assertionCallback(receipt)
      assertionsPassed = true
    } catch(error) {
      assertionsPassed = false
    }

    return assertionsPassed
  }

  async function call(
    title,
    instance,
    method,
    args,
    from,
    value,
    gas,
    gasPrice,
    shouldSucceed,
    assertionCallback
  ) {
    let succeeded = true
    returnValues = await instance.methods[method](...args).call({
      from: from,
      value: value,
      gas: gas,
      gasPrice: gasPrice
    }).catch(error => {
      //console.error(error)
      succeeded = false
    })

    if (succeeded !== shouldSucceed) {
      return false
    } else if (!shouldSucceed) {
      return true
    }

    let assertionsPassed
    try {
      assertionCallback(returnValues)
      assertionsPassed = true
    } catch(error) {
      assertionsPassed = false
    }

    return assertionsPassed
  }

  async function runTest(
    title,
    instance,
    method,
    callOrSend,
    args,
    shouldSucceed,
    assertionCallback,
    from,
    value,
    gas
  ) {
    if (typeof(callOrSend) === 'undefined') {
      callOrSend = 'send'
    }
    if (typeof(args) === 'undefined') {
      args = []
    }
    if (typeof(shouldSucceed) === 'undefined') {
      shouldSucceed = true
    }
    if (typeof(assertionCallback) === 'undefined') {
      assertionCallback = (value) => {}
    }
    if (typeof(from) === 'undefined') {
      from = address
    }
    if (typeof(value) === 'undefined') {
      value = 0
    }
    if (typeof(gas) === 'undefined') {
      gas = gasLimit - 1
    }
    let ok = false
    if (callOrSend === 'send') {
      ok = await send(
        title,
        instance,
        method,
        args,
        from,
        value,
        gas,
        10 ** 1,
        shouldSucceed,
        assertionCallback
      )
    } else if (callOrSend === 'call') {
      ok = await call(
        title,
        instance,
        method,
        args,
        from,
        value,
        gas,
        10 ** 1,
        shouldSucceed,
        assertionCallback
      )
    } else {
      console.error('must use call or send!')
      process.exit(1)
    }

    if (ok) {
      console.log(` ✓ ${title}`)
      passed++
    } else {
      console.log(` ✘ ${title}`)
      failed++
    }
  }

  async function setupNewDefaultAddress(newPrivateKey) {
    const pubKey = await web3.eth.accounts.privateKeyToAccount(newPrivateKey)
    await web3.eth.accounts.wallet.add(pubKey)

    const txCount = await web3.eth.getTransactionCount(pubKey.address)

    if (txCount > 0) {
      console.warn(
        `warning: ${pubKey.address} has already been used, which may cause ` +
        'some tests to fail.'
      )
    }

    await web3.eth.sendTransaction({
      from: originalAddress,
      to: pubKey.address,
      value: 10 ** 18,
      gas: '0x5208',
      gasPrice: '0x4A817C800'
    })

    return pubKey.address
  }

  async function raiseGasLimit(necessaryGas) {
    iterations = 9999
    if (necessaryGas > 8000000) {
      console.error('the gas needed is too high!')
      process.exit(1)
    } else if (typeof necessaryGas === 'undefined') {
      iterations = 20
      necessaryGas = 8000000
    }

    // bring up gas limit if necessary by doing additional transactions
    var block = await web3.eth.getBlock("latest")
    while (iterations > 0 && block.gasLimit < necessaryGas) {
      await web3.eth.sendTransaction({
        from: originalAddress,
        to: originalAddress,
        value: '0x01',
        gas: '0x5208',
        gasPrice: '0x4A817C800'
      })
      var block = await web3.eth.getBlock("latest")
      iterations--
    }

    console.log("raising gasLimit, currently at " + block.gasLimit)
    return block.gasLimit
  }

  async function getDeployGas(dataPayload) {
    await web3.eth.estimateGas({
      from: address,
      data: dataPayload
    }).catch(async error => {
      if (
        error.message === (
          'Returned error: gas required exceeds allowance or always failing ' +
          'transaction'
        )
      ) {
        await raiseGasLimit()
        await getDeployGas(dataPayload)
      }
    })

    deployGas = await web3.eth.estimateGas({
      from: address,
      data: dataPayload
    })

    return deployGas
  }

  // *************************** deploy contracts *************************** //
  let address = await setupNewDefaultAddress(
    '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed'
  )

  let deployGas
  let latestBlock = await web3.eth.getBlock('latest')
  const gasLimit = latestBlock.gasLimit

  const MetamorphicContractFactoryDeployer = new web3.eth.Contract(
    MetamorphicContractFactoryArtifact.abi
  )

  const ImmutableCreate2FactoryDeployer = new web3.eth.Contract(
    ImmutableCreate2FactoryArtifact.abi
  )

  const ContractTwoDeployer = new web3.eth.Contract(
    ContractTwoArtifact.abi
  )

  const CodeCheckDeployer = new web3.eth.Contract(
    CodeCheckArtifact.abi
  )

  const KakunaBasicTestDeployer = new web3.eth.Contract(
    KakunaBasicTestArtifact.abi
  )

  let dataPayload = ImmutableCreate2FactoryDeployer.deploy({
    data: ImmutableCreate2FactoryArtifact.bytecode
  }).encodeABI()

  deployGas = await getDeployGas(dataPayload)

  const ImmutableCreate2Factory = await ImmutableCreate2FactoryDeployer.deploy({
    data: ImmutableCreate2FactoryArtifact.bytecode
  }).send({
    from: address,
    gas: deployGas,
    gasPrice: 10 ** 1
  }).catch(error => {
    console.error(error)
    console.log(
      ` ✘ ImmutableCreate2Factory contract deploys successfully for ${deployGas} gas`
    )
    failed++
    process.exit(1)
  })

  console.log(
    ` ✓ ImmutableCreate2Factory contract deploys successfully for ${deployGas} gas`
  )
  passed++

  dataPayload = MetamorphicContractFactoryDeployer.deploy({
    data: MetamorphicContractFactoryArtifact.bytecode,
    arguments: [TransientContractArtifact.bytecode]
  }).encodeABI()

  deployGas = await getDeployGas(dataPayload)

  const MetamorphicContractFactory = await MetamorphicContractFactoryDeployer.deploy({
    data: MetamorphicContractFactoryArtifact.bytecode,
    arguments: [TransientContractArtifact.bytecode]
  }).send({
    from: address,
    gas: deployGas,
    gasPrice: 10 ** 1
  }).catch(error => {
    console.error(error)
    console.log(
      ` ✘ Metamorphic Contract Factory deploys successfully for ${deployGas} gas`
    )
    failed++
    process.exit(1)
  })

  console.log(
    ` ✓ Metamorphic Contract Factory deploys successfully for ${deployGas} gas`
  )
  passed++

  dataPayload = ContractTwoDeployer.deploy({
    data: ContractTwoArtifact.bytecode
  }).encodeABI()

  deployGas = await getDeployGas(dataPayload)

  const ContractTwo = await ContractTwoDeployer.deploy({
    data: ContractTwoArtifact.bytecode
  }).send({
    from: address,
    gas: deployGas,
    gasPrice: 10 ** 1
  }).catch(error => {
    console.error(error)
    console.log(
      ` ✘ New implementation contract deploys successfully for ${deployGas} gas`
    )
    failed++
    process.exit(1)
  })

  console.log(
    ` ✓ New implementation contract deploys successfully for ${deployGas} gas`
  )
  passed++

  dataPayload = CodeCheckDeployer.deploy({
    data: CodeCheckArtifact.bytecode
  }).encodeABI()

  deployGas = await getDeployGas(dataPayload)

  const CodeCheck = await CodeCheckDeployer.deploy({
    data: CodeCheckArtifact.bytecode
  }).send({
    from: address,
    gas: deployGas,
    gasPrice: 10 ** 1
  }).catch(error => {
    console.error(error)
    console.log(
      ` ✘ CodeCheck contract deploys successfully for ${deployGas} gas`
    )
    failed++
    process.exit(1)
  })

  console.log(
    ` ✓ CodeCheck contract deploys successfully for ${deployGas} gas`
  )
  passed++

  /*
  console.log(MetamorphicContractFactory.options.address)
  console.log(address)
  await runTest(
    'MetamorphicContractFactory can get init code hash of transient contract',
    MetamorphicContractFactory,
    'getTransientContractInitializationCodeHash',
    'call',
    [],
    true,
    value => {
      console.log(value)
    }
  )
  */

  await runTest(
    'MetamorphicContractFactory can deploy Metapod',
    MetamorphicContractFactory,
    'deployMetamorphicContractWithConstructor',
    'send',
    [
      //address + 'e73fb603a03b4000007eb5df',
      address + '10f74f2d75490b0486060000',
      //address + '10f74f2d75490b0486060000',
      MetapodArtifact.bytecode
    ],
    true,
    receipt => {
      assert.strictEqual(
        receipt.events.MetamorphosedWithConstructor.returnValues.metamorphicContract,
        '0x000000000003212eb796dEE588acdbBbD777D4E7'
      )
    }
  )

  const Metapod = new web3.eth.Contract(
    MetapodArtifact.abi,
    '0x000000000003212eb796dEE588acdbBbD777D4E7'
  )

  dataPayload = KakunaBasicTestDeployer.deploy({
    data: KakunaBasicTestArtifact.bytecode
  }).encodeABI()

  deployGas = await getDeployGas(dataPayload)

  const KakunaBasicTest = await KakunaBasicTestDeployer.deploy({
    data: KakunaBasicTestArtifact.bytecode
  }).send({
    from: address,
    gas: deployGas,
    gasPrice: 10 ** 1
  }).catch(error => {
    console.error(error)
    console.log(
      ` ✘ Kakuna test contract deploys successfully for ${deployGas} gas`
    )
    failed++
    process.exit(1)
  })

  console.log(
    ` ✓ Kakuna test contract deploys successfully for ${deployGas} gas`
  )
  passed++

  KakunaBasicTestWithPreludeCode = await kakuna.kakuna(
    'KakunaBasicTest',
    '0x4150', // COINBASE POP, 4 gas no-op
    false // no logging
  )
  KakunaBasicTestWithPreludeInitCode = KakunaBasicTestWithPreludeCode[0]
  KakunaBasicTestWithPreludeRuntime = KakunaBasicTestWithPreludeCode[1]

  dataPayload = KakunaBasicTestDeployer.deploy({
    data: KakunaBasicTestWithPreludeInitCode
  }).encodeABI()

  deployGas = await getDeployGas(dataPayload)

  const KakunaBasicTestWithPrelude = await KakunaBasicTestDeployer.deploy({
    data: KakunaBasicTestWithPreludeInitCode
  }).send({
    from: address,
    gas: deployGas,
    gasPrice: 10 ** 1
  }).catch(error => {
    console.error(error)
    console.log(
      ` ✘ Kakuna test contract with prelude deploys successfully for ${deployGas} gas`
    )
    failed++
    process.exit(1)
  })

  console.log(
    ` ✓ Kakuna test contract with prelude deploys successfully for ${deployGas} gas`
  )
  passed++

  let create2payload = (
    '0xff' +
    MetamorphicContractFactory.options.address.slice(2) +
    address.slice(2) + '000000000000000000000000' +
    web3.utils.keccak256(MetamorphicContractBytecode, {encoding: "hex"}).slice(2)
  )

  let targetMetamorphicContractAddress = web3.utils.toChecksumAddress(
    '0x' + web3.utils.sha3(
      create2payload,
      {encoding: "hex"}
    ).slice(12).substring(14)
  )

  await runTest(
    'MetamorphicContractFactory can check for address of a metamorphic contract',
    MetamorphicContractFactory,
    'findMetamorphicContractAddress',
    'call',
    [
      address + '000000000000000000000000'
    ],
    true,
    value => {
      assert.strictEqual(value, targetMetamorphicContractAddress)
    }
  )

  await runTest(
    'MetamorphicContractFactory can get init code of metamorphic contract',
    MetamorphicContractFactory,
    'getMetamorphicContractInitializationCode',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, MetamorphicContractBytecode)
    }
  )

  await runTest(
    'MetamorphicContractFactory can get init code hash of metamorphic contract',
    MetamorphicContractFactory,
    'getMetamorphicContractInitializationCodeHash',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(
        value,
        web3.utils.keccak256(MetamorphicContractBytecode, {encoding: "hex"})
      )
    }
  )

  await runTest(
    'MetamorphicContractFactory can deploy a metamorphic contract',
    MetamorphicContractFactory,
    'deployMetamorphicContract',
    'send',
    [
      address + '000000000000000000000000',
      ContractOneArtifact.bytecode,
      '0x8129fc1c' // initialize()
    ],
    true,
    receipt => {
      assert.strictEqual(
        receipt.events.Metamorphosed.returnValues.metamorphicContract,
        targetMetamorphicContractAddress
      )
    }
  )

  await runTest(
    'CodeCheck can check the code of the metamorphic contract',
    CodeCheck,
    'check',
    'call',
    [
      targetMetamorphicContractAddress
    ],
    true,
    value => {
      assert.strictEqual(value, ContractOneArtifact.deployedBytecode)    
    }
  )

  let Metamorphic = new web3.eth.Contract(
    ContractOneArtifact.abi,
    targetMetamorphicContractAddress
  )

  await runTest(
    'Metamorphic contract can check for initialized test value',
    Metamorphic,
    'test',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, '1')
    }
  )

  await runTest(
    'Metamorphic contract can be destroyed',
    Metamorphic,
    'destroy'
  )

  await runTest(
    'MetamorphicContractFactory can redeploy a contract using a new implementation',
    MetamorphicContractFactory,
    'deployMetamorphicContractFromExistingImplementation',
    'send',
    [
      address + '000000000000000000000000',
      ContractTwo.options.address,
      '0x'
    ],
    true,
    receipt => {
      assert.strictEqual(
        receipt.events[0].raw.data,
        '0x0000000000000000000000000000000000000000000000000000000000000001'
      )
    },
    address,
    1
  )

  await runTest(
    'CodeCheck can check the code of the new metamorphic contract',
    CodeCheck,
    'check',
    'call',
    [
      targetMetamorphicContractAddress
    ],
    true,
    value => {
      assert.strictEqual(value, ContractTwoArtifact.deployedBytecode)    
    }
  )

  await runTest(
    'Metamorphic contract can check for new test value',
    Metamorphic,
    'test',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, '0')
    }
  )

  create2payload = (
    '0xff' +
    ImmutableCreate2Factory.options.address.slice(2) +
    address.slice(2) + '000000000000000000000000' +
    web3.utils.keccak256('0x3838533838f3').slice(2)
  )

  const targetImmutableContractAddress = web3.utils.toChecksumAddress(
    '0x' + web3.utils.sha3(
      create2payload,
      {encoding: "hex"}
    ).slice(12).substring(14)
  )

  create2payload = (
    '0xff' +
    MetamorphicContractFactory.options.address.slice(2) +
    address.slice(2) + '000000000000000000000000' +
    web3.utils.keccak256(TransientContractArtifact.bytecode).slice(2)
  )

  const targetTransientContractAddress = web3.utils.toChecksumAddress(
    '0x' + web3.utils.sha3(
      create2payload,
      {encoding: "hex"}
    ).slice(12).substring(14)
  )

  targetMetamorphicContractAddress = web3.utils.toChecksumAddress(
    '0x' + web3.utils.sha3(
      '0xd694' + targetTransientContractAddress.slice(2) + '01',
      {encoding: "hex"}
    ).slice(12).substring(14)
  )

  await runTest(
    'MetamorphicContractFactory can check for address of a transient contract',
    MetamorphicContractFactory,
    'findTransientContractAddress',
    'call',
    [
      address + '000000000000000000000000'
    ],
    true,
    value => {
      assert.strictEqual(value, targetTransientContractAddress)
    }
  )

  await runTest(
    'MetamorphicContractFactory can check metamorphic address from transient',
    MetamorphicContractFactory,
    'findMetamorphicContractAddressWithConstructor',
    'call',
    [
      address + '000000000000000000000000'
    ],
    true,
    value => {
      assert.strictEqual(value, targetMetamorphicContractAddress)
    }
  )  

  await runTest(
    'MetamorphicContractFactory can get init code of transient contract',
    MetamorphicContractFactory,
    'getTransientContractInitializationCode',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, TransientContractArtifact.bytecode)
    }
  )

  await runTest(
    'MetamorphicContractFactory can get init code hash of transient contract',
    MetamorphicContractFactory,
    'getTransientContractInitializationCodeHash',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(
        value,
        web3.utils.keccak256(
          TransientContractArtifact.bytecode,
          {encoding: 'hex'}
        )
      )
    }
  )

  await runTest(
    'MetamorphicContractFactory can deploy metamorphic contract w/ constructor',
    MetamorphicContractFactory,
    'deployMetamorphicContractWithConstructor',
    'send',
    [
      address + '000000000000000000000000',
      ContractWithConstructorArtifact.bytecode
    ],
    true,
    receipt => {
      assert.strictEqual(
        receipt.events.MetamorphosedWithConstructor.returnValues.metamorphicContract,
        targetMetamorphicContractAddress
      )
      assert.strictEqual(
        receipt.events.MetamorphosedWithConstructor.returnValues.transientContract,
        targetTransientContractAddress
      )
    }
  )

  Metamorphic = new web3.eth.Contract(
    ContractWithConstructorArtifact.abi,
    targetMetamorphicContractAddress
  )

  await runTest(
    'Metamorphic contract can check for new test value',
    Metamorphic,
    'test',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, '3')
    }
  )

  await runTest(
    'Metamorphic contract can be destroyed',
    Metamorphic,
    'destroy'
  )

  await runTest(
    'MetamorphicContractFactory can redeploy a metamorphic contract w/ transient',
    MetamorphicContractFactory,
    'deployMetamorphicContractWithConstructor',
    'send',
    [
      address + '000000000000000000000000',
      ContractTwoArtifact.bytecode
    ],
    true,
    receipt => {
      assert.strictEqual(
        receipt.events.MetamorphosedWithConstructor.returnValues.metamorphicContract,
        targetMetamorphicContractAddress
      )
      assert.strictEqual(
        receipt.events.MetamorphosedWithConstructor.returnValues.transientContract,
        targetTransientContractAddress
      )
    }
  )  

  await runTest(
    'Metamorphic contract can check for new test value',
    Metamorphic,
    'test',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, '0')
    }
  )

  await runTest(
    'ImmutableCreate2Factory can check a deployment address',
    ImmutableCreate2Factory,
    'findCreate2Address',
    'call',
    [
      address + '000000000000000000000000',
      '0x3838533838f3'
    ],
    true,
    value => {
      assert.strictEqual(value, targetImmutableContractAddress)
    }
  )

  await runTest(
    'ImmutableCreate2Factory can check deployment address using init code hash',
    ImmutableCreate2Factory,
    'findCreate2AddressViaHash',
    'call',
    [
      address + '000000000000000000000000',
      web3.utils.keccak256('0x3838533838f3', {encoding: "hex"})
    ],
    true,
    value => {
      assert.strictEqual(value, targetImmutableContractAddress)
    }
  )

  await runTest(
    'ImmutableCreate2Factory can check if a contract has been deployed',
    ImmutableCreate2Factory,
    'hasBeenDeployed',
    'call',
    [
      targetImmutableContractAddress
    ],
    true,
    value => {
      assert.strictEqual(value, false)
    }
  )

  await runTest(
    'ImmutableCreate2Factory can deploy a contract with collision avoidance',
    ImmutableCreate2Factory,
    'safeCreate2',
    'send',
    [
      address + '000000000000000000000000',
      '0x3838533838f3'
    ]
  )

  await runTest(
    'ImmutableCreate2Factory can check once a contract has been deployed',
    ImmutableCreate2Factory,
    'hasBeenDeployed',
    'call',
    [
      targetImmutableContractAddress
    ],
    true,
    value => {
      assert.strictEqual(value, true)
    }
  )

  await runTest(
    'ImmutableCreate2Factory cannot deploy the same contract twice',
    ImmutableCreate2Factory,
    'safeCreate2',
    'send',
    [
      address + '000000000000000000000000',
      '0x3838533838f3'
    ],
    false
  )

  await runTest(
    'ImmutableCreate2Factory cannot deploy a contract from invalid address',
    ImmutableCreate2Factory,
    'safeCreate2',
    'send',
    [
      '0x1000000000000000000000000000000000000000000000000000000000000000',
      '0x3838533838f3'
    ],
    false
  )

  await runTest(
    'ImmutableCreate2Factory can deploy a contract with no collision avoidance',
    ImmutableCreate2Factory,
    'safeCreate2',
    'send',
    [
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      '0x3838533838f3'
    ]
  )

  let metapodMetamorphicContractAddress
  await runTest(
    'Metapod can determine the address of a metamorphic contract',
    Metapod,
    'findMetamorphicContractAddress',
    'call',
    [
      address + '000000000000000000000000'
    ],
    true,
    value => {
      metapodMetamorphicContractAddress = value
    }
  )  

  let metapodTransientContractAddress
  await runTest(
    'Metapod can determine the address of a transient contract',
    Metapod,
    'findTransientContractAddress',
    'call',
    [
      address + '000000000000000000000000'
    ],
    true,
    value => {
      metapodTransientContractAddress = value
    }
  )  

  let metapodVaultContractAddress
  await runTest(
    'Metapod can determine the address of a vault contract',
    Metapod,
    'findVaultContractAddress',
    'call',
    [
      address + '000000000000000000000000'
    ],
    true,
    value => {
      metapodVaultContractAddress = value
    }
  )

  await runTest(
    'Metapod reverts when deploying a metamorphic contract that reverts',
    Metapod,
    'deploy',
    'send',
    [
      0,
      '0xfe'
    ],
    false
  )

  await runTest(
    'CodeCheck confirms that no transient contract exists yet',
    CodeCheck,
    'check',
    'call',
    [
      metapodTransientContractAddress
    ],
    true,
    value => {
      assert.strictEqual(value, null)    
    }
  )

  await runTest(
    'CodeCheck confirms that no metamorphic contract exists yet',
    CodeCheck,
    'check',
    'call',
    [
      metapodMetamorphicContractAddress
    ],
    true,
    value => {
      assert.strictEqual(value, null)    
    }
  )

  await runTest(
    'Metapod can deploy a contract',
    Metapod,
    'deploy',
    'send',
    [
      0,
      (
        '0x603680600b6000396000f36e' + 
        Metapod.options.address.slice(2 + (2 * 5)) +
        '3318602b5773' +
        metapodVaultContractAddress.slice(2) +
        'ff5b600160005260206000f3'
      )
    ],
    true,
    receipt => {
      assert.strictEqual(
        receipt.events.Metamorphosed.returnValues.metamorphicContract,
        metapodMetamorphicContractAddress
      )
    }
  )

  await runTest(
    'CodeCheck can check the code of the new transient contract',
    CodeCheck,
    'check',
    'call',
    [
      metapodTransientContractAddress
    ],
    true,
    value => {
      assert.strictEqual(value, null)    
    }
  )

  await runTest(
    'Metapod can determine the necessary prelude',
    Metapod,
    'getPrelude',
    'call',
    [
      address + '000000000000000000000000',
    ],
    true,
    value => {
      assert.strictEqual(
        value,
        (
          '0x6e' + 
          Metapod.options.address.slice(2 + (2 * 5)).toLowerCase() +
          '3318602b5773' +
          metapodVaultContractAddress.slice(2).toLowerCase() +
          'ff5b'
        )
      )
    }
  )

  await runTest(
    'CodeCheck can check the code of the new metamorphic contract',
    CodeCheck,
    'check',
    'call',
    [
      metapodMetamorphicContractAddress
    ],
    true,
    value => {
      assert.strictEqual(
        value,
        (
          '0x6e' + 
          Metapod.options.address.slice(2 + (2 * 5)).toLowerCase() +
          '3318602b5773' +
          metapodVaultContractAddress.slice(2).toLowerCase() +
          'ff5b600160005260206000f3'
        )
      )    
    }
  )

  await runTest(
    'CodeCheck confirms that no vault contract exists yet',
    CodeCheck,
    'check',
    'call',
    [
      metapodVaultContractAddress
    ],
    true,
    value => {
      assert.strictEqual(value, null)    
    }
  )

  await runTest(
    'Metapod can destroy a metamorphic contract',
    Metapod,
    'destroy',
    'send',
    [
      0
    ]
  )

  await runTest(
    'Metapod can get the salt given an identifier',
    Metapod,
    'getSalt',
    'call',
    [
      0
    ],
    true,
    value => {
      assert.strictEqual(
        value,
        address.toLowerCase() + '000000000000000000000000'
      )
    }
  )

  await runTest(
    'Metapod can get the salt given the max identifier',
    Metapod,
    'getSalt',
    'call',
    [
      -1
    ],
    true,
    value => {
      assert.strictEqual(
        value,
        address.toLowerCase() + 'ffffffffffffffffffffffff'
      )
    }
  )

  result = await web3.eth.call({
    from: address,
    to: Metapod.options.address,
    value: 0,
    gas: 100000,
    gasPrice: '0x4A817C800',
    data: '0x1215c971ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  })
  assert.strictEqual(result, address.toLowerCase() + 'ffffffffffffffffffffffff')
  console.log(' ✓ extra dirty bits are correctly cleaned from identifier')
  passed++


  await runTest(
    'CodeCheck confirms that no metamorphic contract exists anymore',
    CodeCheck,
    'check',
    'call',
    [
      metapodMetamorphicContractAddress
    ],
    true,
    value => {
      assert.strictEqual(value, null)    
    }
  )

  await runTest(
    'Metapod can redeploy a contract and include a value',
    Metapod,
    'deploy',
    'send',
    [
      0,
      (
        '0x603680600b6000396000f36e' + 
        Metapod.options.address.slice(2 + (2 * 5)) +
        '3318602b5773' +
        metapodVaultContractAddress.slice(2) +
        'ff5b600160005260206000f3'
      )
    ],
    true,
    receipt => {
      assert.strictEqual(
        receipt.events.Metamorphosed.returnValues.metamorphicContract,
        metapodMetamorphicContractAddress
      )
    },
    address,
    12345
  )

  await runTest(
    'CodeCheck can check the code of the new transient contract',
    CodeCheck,
    'check',
    'call',
    [
      metapodTransientContractAddress
    ],
    true,
    value => {
      assert.strictEqual(value, null)    
    }
  )

  await runTest(
    'CodeCheck can check the code of the new metamorphic contract',
    CodeCheck,
    'check',
    'call',
    [
      metapodMetamorphicContractAddress
    ],
    true,
    value => {
      assert.strictEqual(
        value,
        (
          '0x6e' + 
          Metapod.options.address.slice(2 + (2 * 5)).toLowerCase() +
          '3318602b5773' +
          metapodVaultContractAddress.slice(2).toLowerCase() +
          'ff5b600160005260206000f3'
        )
      )    
    }
  )

  balance = await web3.eth.getBalance(metapodMetamorphicContractAddress)
  assert.strictEqual(balance, '12345')
  console.log(' ✓ balance of metamorphic contract is correct')
  passed++

  await runTest(
    'CodeCheck confirms that no vault contract exists yet',
    CodeCheck,
    'check',
    'call',
    [
      metapodVaultContractAddress
    ],
    true,
    value => {
      assert.strictEqual(value, null)    
    }
  )

  await runTest(
    'Metapod can destroy a metamorphic contract with a balance',
    Metapod,
    'destroy',
    'send',
    [
      0
    ]
  )

  await runTest(
    'CodeCheck confirms that no vault contract exists yet',
    CodeCheck,
    'check',
    'call',
    [
      metapodVaultContractAddress
    ],
    true,
    value => {
      assert.strictEqual(value, null)    
    }
  )

  balance = await web3.eth.getBalance(metapodVaultContractAddress)
  assert.strictEqual(balance, '12345')
  console.log(' ✓ balance of vault contract is correct')
  passed++

  await runTest(
    'Metapod can redeploy a contract when the vault has a balance',
    Metapod,
    'deploy',
    'send',
    [
      0,
      (
        '0x603680600b6000396000f36e' + 
        Metapod.options.address.slice(2 + (2 * 5)) +
        '3318602b5773' +
        metapodVaultContractAddress.slice(2) +
        'ff5b600160005260206000f3'
      )
    ],
    true,
    receipt => {
      assert.strictEqual(
        receipt.events.Metamorphosed.returnValues.metamorphicContract,
        metapodMetamorphicContractAddress
      )
    },
    address,
    1
  )

  await runTest(
    'CodeCheck confirms that a vault contract now exists',
    CodeCheck,
    'check',
    'call',
    [
      metapodVaultContractAddress
    ],
    true,
    value => {
      assert.strictEqual(
        value,
        (
          "0x586e" +
          Metapod.options.address.slice(2 + (2 * 5)).toLowerCase() +
          "33185857595959303173" +
          metapodTransientContractAddress.slice(2).toLowerCase() +
          "5af1"
        )
      )
    }
  )

  balance = await web3.eth.getBalance(metapodMetamorphicContractAddress)
  assert.strictEqual(balance, '12346')
  console.log(' ✓ balance of metamorphic contract is correct')
  passed++

  await runTest(
    'Metapod can destroy a metamorphic contract with balance once vault exists',
    Metapod,
    'destroy',
    'send',
    [
      0
    ]
  )

  balance = await web3.eth.getBalance(metapodVaultContractAddress)
  assert.strictEqual(balance, '12346')
  console.log(' ✓ balance of vault contract is correct')
  passed++

  await runTest(
    'Metapod can redeploy a contract when the vault is deployed with a balance',
    Metapod,
    'deploy',
    'send',
    [
      0,
      (
        '0x603680600b6000396000f36e' + 
        Metapod.options.address.slice(2 + (2 * 5)) +
        '3318602b5773' +
        metapodVaultContractAddress.slice(2) +
        'ff5b600160005260206000f3'
      )
    ],
    true,
    receipt => {
      assert.strictEqual(
        receipt.events.Metamorphosed.returnValues.metamorphicContract,
        metapodMetamorphicContractAddress
      )
    },
    address,
    10
  )

  balance = await web3.eth.getBalance(metapodMetamorphicContractAddress)
  assert.strictEqual(balance, '12356')
  console.log(' ✓ balance of metamorphic contract is correct')
  passed++

  await runTest(
    'Metapod can destroy a metamorphic contract with balance ahead of recover',
    Metapod,
    'destroy',
    'send',
    [
      0
    ]
  )

  balance = await web3.eth.getBalance(metapodVaultContractAddress)
  assert.strictEqual(balance, '12356')
  console.log(' ✓ balance of vault contract is correct')
  passed++

  // check address balance beforehand (use proxy?)
  await runTest(
    'Metapod can recover the balance',
    Metapod,
    'recover',
    'send',
    [
      0
    ]
  )
  // check address balance afterwards

  balance = await web3.eth.getBalance(metapodVaultContractAddress)
  assert.strictEqual(balance, '0')
  console.log(' ✓ balance of vault contract is correct')
  passed++

  console.log('### Testing KakunaBasicTest without prelude ###')

  await runTest(
    'constructor correctly sets test value',
    KakunaBasicTest,
    'constructorTest',
    'call',
    [],
    true,
    value => {
      assert.ok(value)
    }
  )

  await runTest(
    'codecopy test correctly retrieves constant value',
    KakunaBasicTest,
    'codecopyTest',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(
        value,
        'This is an example string for testing CODECOPY.'
      )
    }
  )

  await runTest(
    'jump test correctly jumps to first internal function',
    KakunaBasicTest,
    'jumpTest',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(
        value,
        false
      )
    },
    address,
    0,
    30001
  )

  await runTest(
    'jump test correctly jumps to second internal function',
    KakunaBasicTest,
    'jumpTest',
    'call',
    [],
    true,
    value => {
      assert.ok(value)
    },
    address,
    0,
    30002
  )

  console.log('### Testing KakunaBasicTest with prelude ###')

  await runTest(
    'constructor correctly sets test value',
    KakunaBasicTestWithPrelude,
    'constructorTest',
    'call',
    [],
    true,
    value => {
      assert.ok(value)
    }
  )

  await runTest(
    'codecopy test correctly retrieves constant value',
    KakunaBasicTestWithPrelude,
    'codecopyTest',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(
        value,
        'This is an example string for testing CODECOPY.'
      )
    }
  )

  await runTest(
    'jump test correctly jumps to first internal function',
    KakunaBasicTestWithPrelude,
    'jumpTest',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(
        value,
        false
      )
    },
    address,
    0,
    30001
  )

  await runTest(
    'jump test correctly jumps to second internal function',
    KakunaBasicTestWithPrelude,
    'jumpTest',
    'call',
    [],
    true,
    value => {
      assert.ok(value)
    },
    address,
    0,
    30002
  )

  console.log('### Testing Metapod with Kakuna ###')

  metapodPrelude = `0x6e${
    Metapod.options.address.toLowerCase().slice(2 + (2 * 5))
  }3318602b5773${
    metapodVaultContractAddress.toLowerCase().slice(2)
  }ff5b`

  ContractOneWithPrelude = await kakuna.kakuna(
    'ContractOne',
    metapodPrelude,
    false // no logging
  )
  kakunaInitCode = ContractOneWithPrelude[0]
  kakunaRuntime = ContractOneWithPrelude[1]

  await runTest(
    'Metapod can deploy a contract from Kakuna with the appropriate prelude',
    Metapod,
    'deploy',
    'send',
    [
      0,
      Buffer.from(kakunaInitCode.slice(2), 'hex')
    ],
    true,
    receipt => {
      assert.strictEqual(
        receipt.events.Metamorphosed.returnValues.metamorphicContract,
        metapodMetamorphicContractAddress
      )
    }
  )

  const MetapodKakunaContract = new web3.eth.Contract(
    ContractOneArtifact.abi,
    metapodMetamorphicContractAddress
  )

  await runTest(
    'CodeCheck can check the code of the new metamorphic contract',
    CodeCheck,
    'check',
    'call',
    [
      metapodMetamorphicContractAddress
    ],
    true,
    value => {
      assert.strictEqual(
        value,
        kakunaRuntime
      )    
    }
  )

  await runTest(
    'Deployed contract can be interacted with',
    MetapodKakunaContract,
    'initialize'
  )

  await runTest(
    'Deployed contract interaction works',
    MetapodKakunaContract,
    'test',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, '1')
    }
  )

  await runTest(
    'Metapod can destroy a metamorphic contract from Kakuna',
    Metapod,
    'destroy',
    'send',
    [0]
  )

  console.log(
    `completed ${passed + failed} test${passed + failed === 1 ? '' : 's'} ` +
    `with ${failed} failure${failed === 1 ? '' : 's'}.`
  )

  if (failed > 0) {
    process.exit(1)
  }

  // exit.
  return 0

}}
