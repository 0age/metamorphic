var kakuna = require('./kakuna.js')

async function main() {
	if (process.argv.length < 4) {
	  throw new Error('supply the name of the compiled contract and the bytecode of the prelude as arguments.')
	}

	const contractName = process.argv[2]
	const preludeRaw = process.argv[3]

	if (!(preludeRaw.slice(0, 2) === '0x')) {
	  throw new Error('Be sure to format the prelude as a hex string: `0xc0de...`')
	}
	let initCode
	let runtimeCode

	code = await kakuna.kakuna(contractName, preludeRaw, true)

	console.log('INIT CODE:', code[0])
	console.log()
	console.log('RUNTIME CODE:', code[1])
}

main()