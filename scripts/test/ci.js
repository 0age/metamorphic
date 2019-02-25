const connectionConfig = require('../../truffle-config.js')

const connection = connectionConfig.networks['development']

let web3Provider = connection.provider

// import tests
var test = require('./test.js')

// run tests
async function runTests() {
	await test.test(web3Provider, 'development')
	process.exit(0)
}

runTests()
