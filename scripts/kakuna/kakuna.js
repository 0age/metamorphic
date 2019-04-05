BN = require('bn.js')
fs = require('fs')
utils = require('ethereumjs-util')
VM = require('ethereumjs-vm')
Web3 = require('web3')

module.exports = {kakuna: async function (contractName, preludeRaw, logging) {
  vm = new VM()
  web3 = new Web3()

  const prelude = Buffer.from(preludeRaw.slice(2), 'hex')
  const preludeSize = prelude.length

  if (logging) {
    console.log(`Attempting jump analysis and prelude insertion for ${contractName} contract.`)
    console.log(`Prelude: ${preludeRaw} (length: ${preludeSize} bytes)`)
  }

  // get the bytecode of the test contract that we want to add a prelude to
  const Artifact = require(`../../build/contracts/${contractName}.json`)

  /* init code: checks and constructor logic, then keyword, then runtime code.
    
    keyword: 0x61****8061****60003960f3fe (13 bytes)

    #  op  opcode
    0  61  PUSH2 0x022b // length - this will need to be increased
    1  80  DUP1         // duplicated so the return can use it too
    2  61  PUSH2 0x003a // offset - this will not change
    3  60  PUSH1 0x00   // dest offset - runtime code at 0 in memory
    4  39  CODECOPY     // get the code and place it in memory
    5  60  PUSH1 0x00   // return offset - runtime starting at 0
    6  F3  RETURN       // return runtime code from memory and deploy

    also note that the PUSH2s might actually be PUSH1s, depending on the size.
  */
  let initCode = Buffer.from(Artifact.bytecode.slice(2), 'hex')

  // parse out the init code by each instruction.
  initOps = nameOpCodes(initCode)

  // find the first occurrence of the full sequence of opcodes in the keyword
  const sequence = ['PUSH', 'DUP1', 'PUSH', 'PUSH', 'CODECOPY', 'PUSH', 'RETURN']
  let candidate = {
    sequenceStart: 0,
    sequenceProgress: 0,
    found: false
  }
  initOps.some((op, i) => {
    if (op.opcode.includes(sequence[candidate.sequenceProgress])) {
      candidate.sequenceProgress++
    } else {
      candidate.sequenceStart = i + 1
      candidate.sequenceProgress = 0
    }
    if (candidate.sequenceProgress >= 7) {
      candidate.found = true
      return true
    }
  })

  if (!candidate.found) {
    throw new Error(
      'No valid runtime keyword found for supplied initialization code.'
    )
  }

  // mark the start of runtime code based on the extracted keyword.
  const codeStart = parseInt(initOps[candidate.sequenceStart + 2].push.data, 16)
  
  if (logging) {
    console.log()
    console.log(
      '##################################################################'
    )
    console.log(
      `runtime payload at instruction #${
        candidate.sequenceStart
      }: pc ${
        initOps[candidate.sequenceStart].pc
      }, length ${
        parseInt(initOps[candidate.sequenceStart].push.data, 16)
      }, offset ${
        codeStart
      }.`
    )
    console.log(initOps[candidate.sequenceStart])
    console.log(
      '##################################################################'
    )
  }

  // get the initialization code without the runtime portion.
  initCodeWithoutRuntime = initCode.slice(0, codeStart)

  // get the runtime code and ensure that it matches the existing runtime code
  let runtime = Buffer.from(Artifact.deployedBytecode.slice(2), 'hex')
  extractedRuntime = initCode.slice(codeStart, initCode.length)
  if (!(runtime.toString() === extractedRuntime.toString())) {
    throw new Error('runtime does not match expected runtime.')
    process.exit()
  }

  // parse out individual op instructions from runtime (remove metadata hash)
  ops = nameOpCodes(Buffer.from(Artifact.deployedBytecode.slice(2, -86), 'hex'))
  
  // include each prior instruction - used to check for adjacent PUSHes + JUMPs.
  priors = [null].concat(ops.slice(0, -1))
  opsAndPriors = []
  ops.forEach((op, index) => {
    if (priors[index] !== null) {
      opsAndPriors.push({
        i: index,
        x: op.x,
        pc: op.pc,
        opcode: op.opcode,
        push: {data: op.push.data},
        prior: {
          x: priors[index].x,
          pc: priors[index].pc,
          opcode: priors[index].opcode,
          push: {data: priors[index].push.data}   
        }
      })
    } else {
      opsAndPriors.push({
        i: index,
        x: op.x,
        pc: op.pc,
        opcode: op.opcode,
        push: {data: op.push.data},
        prior: null
      })
    }
  })

  // locate and index each PUSH instruction.
  originalPushes = []
  originalPushIndexes = {}
  originalPushIndex = 0
  opsAndPriors.forEach(op => {
    if (op.opcode.includes('PUSH')) {
      originalPushIndexes[op.pc] = originalPushIndex
      originalPushes.push(op)
      originalPushIndex++
    }
  })

  // locate and index each JUMP / JUMPI instruction.
  originalJumps = []
  originalJumpIndexes = {}
  originalJumpIndex = 0
  opsAndPriors.forEach(op => {
    if (op.opcode.includes('JUMP') && !op.opcode.includes('JUMPDEST')) {
      originalJumpIndexes[op.pc] = originalJumpIndex
      originalJumps.push(op)
      originalJumpIndex++
    }
  })

  // locate and index each JUMPDEST instruction.
  originalJumpdests = []
  originalJumpdestIndexes = {}
  originalJumpdestIndex = 0
  opsAndPriors.forEach(op => {
    if (op.opcode.includes('JUMPDEST')) {
      originalJumpdestIndexes[op.pc] = originalJumpdestIndex
      originalJumpdests.push(op)
      originalJumpdestIndex++
    }
  })

  // construct a more detailed set of instructions with contextual information.
  opsAndJumps = []
  opsAndPriors.forEach(op => {
    if (op.opcode.includes("JUMP")) {
      if (op.opcode.includes("DEST")) {
        opsAndJumps.push({
          i: op.i,
          x: op.x,
          pc: op.pc,
          opcode: op.opcode,
          push: {data: op.push.data},
          prior: op.prior,
          jump: null,
          jumpdest: {
            index: originalJumpdestIndexes[op.pc]
          }
        })
      } else {
        opsAndJumps.push({
          i: op.i,
          x: op.x,
          pc: op.pc,
          opcode: op.opcode,
          push: {data: op.push.data},
          prior: op.prior,
          jump: {
            index: originalJumpIndexes[op.pc]
          },
          jumpdest: null
        })
      } 
    } else if (op.opcode.includes("PUSH")) {
      opsAndJumps.push({
        i: op.i,
        x: op.x,
        pc: op.pc,
        opcode: op.opcode,
        push: {index: originalPushIndexes[op.pc], data: op.push.data, dataBaseTen: parseInt(op.push.data, 16)},
        prior: op.prior,
        jump: null,
        jumpdest: null
      })
    } else {
      opsAndJumps.push({
        i: op.i,
        x: op.x,
        pc: op.pc,
        opcode: op.opcode,
        push: {data: op.push.data, dataBaseTen: parseInt(op.push.data, 16)},
        prior: op.prior,
        jump: null,
        jumpdest: null
      })
    }
  })

  // create a mapping from each program counter to each instruction index.
  instructions = {}
  opsAndJumps.forEach(op => {
    instructions[op.pc] = op.i
  })

  // create a new instance of a Stack class.
  stack = new Stack()

  // create a new instance of a Counter class.
  counter = new Counter()

  // track which code branches have already been run (circular references)
  completedOneBranches = {}
  completedZeroBranches = {}

  // run through code & build up modified stack until halt or breaker is tripped
  breaker = 0
  function run(fork, currentStack, counter) {
    while (!counter.stopped && breaker < 10000) {
      var op = opsAndJumps[counter.instruction];
      var stackSize = currentStack.length

      // make sure the opcode is included in opFns
      if (!op.opcode in opFns) {
        console.log('DEBUG:', op.opcode)
        throw new Error('Missing opcode')
      }

      // update CODECOPY in the event that the offset stack item is known
      if (
        op.opcode === 'CODECOPY' &&
        currentStack._store[currentStack.length - 2].constant === true
      ) {
        opsAndJumps[counter.instruction].codecopy = {
          constant: true,
          origin: currentStack._store[currentStack.length - 2].origin,
          codeOffset: currentStack._store[currentStack.length - 2].item,
          duplicated: currentStack._store[currentStack.length - 2].duplicated
        }
      }

      // strip out number from PUSH / DUP / SWAP / LOG, will be added back later
      if (
        op.opcode.includes("PUSH") ||
        op.opcode.includes("DUP") ||
        op.opcode.includes("SWAP") ||
        op.opcode.includes("LOG")
      ) {
        // execute the instruction
        opFns[op.opcode.slice(
          0,
          (
            op.opcode.includes("DUP") ||
            op.opcode.includes("LOG")
          ) ? 3 : 4
        )](op, currentStack, counter)
        
        // ensure that the stack size is still OK
        if (stackSize + stackDelta(op) !== currentStack.length) {
          console.log('DEBUG:', op, stackSize, stackDelta(op), currentStack.length)
          throw new Error('unexpected stack size change!')
        }
      // For JUMPI: if condition is unknown, fork and take both possible paths
      } else if (
          op.opcode === 'JUMPI' &&
          currentStack._store[currentStack.length - 2].constant === false
      ) {
        // clone the stack for use in the fork
        var clone = Object.assign(
          Object.create(Object.getPrototypeOf(currentStack)),
          currentStack
        )
        clone._store = clone._store.slice(0)

        // clone the counter too
        var c = Object.assign(Object.create(Object.getPrototypeOf(counter)), counter)

        // set the condition to True
        clone._store[clone.length - 2] = {
          constant: true,
          item: new BN(1)
        }

        // designate a key based on the stack and the jump location
        var key = JSON.stringify({i: op.jump.index, s: clone._store.slice(0).map(x => {return {c: x.constant, d: x.duplicated}})})
        
        // only perform fork if stack has changed & hasn't already forked a lot
        if (completedOneBranches[key] !== true && fork < 30) {
          // recursive call, then record that truthy has been tried for stack
          run(fork + 1, clone, c)
          completedOneBranches[key] = true
        }
        
        // now set the condition to false in the old stack and proceed as normal
        currentStack._store[currentStack.length - 2] = {
          constant: true,
          item: new BN(0)
        }

        // execute instruction & record that not-truthy has been tried for stack
        opFns[op.opcode](op, currentStack, counter)
        completedZeroBranches[op.jump.index] = true // not using this yet :)
        
        // ensure that the stack size is still OK
        if (stackSize + stackDelta(op) !== currentStack.length) {
          console.log('DEBUG:', op, stackSize, stackDelta(op), currentStack.length)
          throw new Error('unexpected stack size change!')
        }
      // if none of the above applies, just keep going through the opcodes
      } else {
        // execute instruction
        opFns[op.opcode](op, currentStack, counter)
        // ensure that the stack size is still OK
        if (stackSize + stackDelta(op) !== currentStack.length) {
          console.log('DEBUG:', op, stackSize, stackDelta(op), currentStack.length)
          throw new Error('unexpected stack size change!')
        }
      }
      
      // increment the counter and breaker, stopping if we reach the end
      counter.increment()
      if (counter.instruction >= opsAndJumps.length) {
        counter.stop()
      }
      breaker++
    }
  }

  // kick off run to start populating modified stack and search for stack items
  run(0, stack, counter)

  // TODO: work BACKWARDS from each remaining problem, looking for the PUSH
  // (basically, all the routes through the code might not be located)

  // last-ditch attempt in case only basic static jumps remain
  opsAndJumps.forEach(op => {
    if (
      op.opcode.includes('JUMP') &&
      !op.opcode.includes('DEST') &&
      !op.jump.origins &&
      op.prior.opcode.includes('PUSH')
    ) {
      op.jump.origins = [{
        index: originalPushIndexes[op.prior.pc],
        pc: op.prior.pc,
        static: true,
        duplicated: false
      }]
      op.jump.dests = [{
        index: originalJumpdestIndexes[parseInt(op.prior.push.data, 16)],
        pc: parseInt(op.prior.push.data, 16)
      }]
    }
  })

  // build up an updated group of jumps, identifying any remaining problems
  jumps = []
  if (logging) {
    console.log()
    console.log(
      '************* PUSH ************* '+
      ' ************ JUMP ************ '+
      ' ********** JUMPDEST **********'
    )
  }
  opsAndJumps.forEach(op => {
    if (op.opcode.includes('JUMP') && !op.opcode.includes('DEST')) {
      if (op.jump.origins) {
        if (logging) {
          // don't mind the mess :D
          console.log(
            `${op.jump.origins.map(x => `${x.index} (pc ${x.pc}: ${
                originalPushes[x.index].opcode
              } 0x${originalPushes[x.index].push.data}${
                x.duplicated ? ", DUP'd!" : ''})`).join(', ')
            }     \t=>\t ${op.jump.index} (pc ${op.pc}: ${op.opcode
            })  \t=>\t${op.jump.dests.map(
              x => `${x.index} (pc ${x.pc}: JUMPDEST)`
            )}`
          )
        }
        jumps.push({
          problem: false,
          index: op.jump.index,
          pc: op.pc,
          origins: op.jump.origins,
          dests: op.jump.dests
        })
      } else {
        if (logging) {
          console.log('PROBLEM:', op.jump.index, op)
        }
        jumps.push({
          problem: true,
          index: op.jump.index,
          pc: op.pc,
          origins: [],
          dests: []
        })
      }
    }
  })

  // do the same for codecopies
  codecopies = []
  if (logging) {
    console.log()
    console.log(
      '************* PUSH ************* '+
      ' ******************** CODECOPY ********************'
    )
  }
  codecopyIndex = 0
  opsAndJumps.forEach(op => {
    if (op.opcode === 'CODECOPY') {
      if (op.codecopy && op.codecopy.constant === true && op.codecopy.origin) {
        const originIndex = originalPushIndexes[op.codecopy.origin]
        let origin = originalPushes[originIndex]
        origin.duplicated = op.codecopy.duplicated
        if (logging) {
          // can't be bothered to clean up...
          console.log(
            `${originIndex} (pc ${origin.pc}: ${origin.opcode} 0x${
              origin.push.data}${origin.duplicated ? ", DUP'd!" : ''
            })   \t=>\t ${codecopyIndex} (pc ${op.pc}: ${
              op.opcode
            } <code offset ${op.codecopy.codeOffset.toString()}>)`)
        }
        codecopies.push({
          problem: false,
          op: op
        })
      } else {
        if (logging) {
          console.log(
            `???????????????????????????????????????\t=>\t ${
              codecopyIndex
            } (pc ${op.pc}: ${op.opcode} <code offset unknown>)`
          )
        }
        codecopies.push({
          problem: true,
          op: op
        })
      }
      codecopyIndex++
    }
  })

  if (logging) {
    console.log()
  }

  // sanity check for jumps
  opsAndJumps.forEach(op => {
    if (
      op.opcode.includes('JUMP') &&
      !op.opcode.includes('DEST') && (
        typeof op.jump.origins === 'undefined' ||
        op.jump.origins.some(o => o.static === false)
      )) {
      if (logging) {
        console.log(op)
      }
      throw new Error("cannot assign a specific push to each jump.")
    }
  })

  // Increase each PUSH to a JUMPDEST in runtime code by length of prelude
  let jumpPushSize = null;
  jumps.forEach(jump => {
    if (!(jump.problem === false)) {
      throw new Error('cannot adjust problematic push used to jump.')
    }

    jump.origins.forEach((origin, index) => {
      if (!(origin.static === true)) {
        throw new Error('only static pushes are supported for now.')
      }

      if (!(origin.duplicated === false)) {
        throw new Error('only unduplicated pushes are supported for now.')
      }

      // get the relevant instruction so that we can parse out the data field
      let pushInstruction = opsAndJumps[instructions[origin.pc]]

      // find out if it's a PUSH1 or PUSH2 and adjust accordingly
      let pushSize = 0
      if (pushInstruction.opcode === 'PUSH1') {
        pushSize = 1
        if (jumpPushSize === null) {
          jumpPushSize = 1
        }
      } else if (pushInstruction.opcode === 'PUSH2') {
        pushSize = 2
        if (jumpPushSize === null) {
          jumpPushSize = 2
        }
      }

      if (pushSize === 0) {
        throw new Error('only PUSH1 and PUSH2 opcodes are supported for now.')
      }

      if (jumpPushSize !== pushSize) {
        throw new Error('size of PUSH opcodes must be consistent.')
      }
      
      // modify the relevant runtime code (TODO: ensure it doesn't overflow!)
      let modified = Buffer.from(
        (
          runtime.slice(
            pushInstruction.pc + 1,
            pushInstruction.pc + 1 + pushSize
          ).readUIntBE(0, pushSize) + preludeSize
        ).toString(16).padStart(2 * pushSize, '0'),
        'hex'
      )

      // update the runtime with the new modified code
      let runtimeSegments = [
        runtime.slice(0, pushInstruction.pc + 1),
        modified,
        runtime.slice(pushInstruction.pc + 1 + pushSize)
      ];
      runtime = Buffer.concat(runtimeSegments);
    })
  })

  // Increase each PUSH to a CODECOPY offset in runtime code by prelude length
  let codecopyPushSize = null;
  codecopies.forEach(codecopy => {
    if (!(codecopy.problem === false)) {
      throw new Error('cannot adjust problematic codecopy offset.')
    }

    // get the relevant instruction so that we can parse out the data field
    let pushInstruction = opsAndJumps[instructions[codecopy.op.codecopy.origin]]

    // find out if it's a PUSH1 or PUSH2 and adjust accordingly
    let pushSize = 0
    if (pushInstruction.opcode === 'PUSH1') {
      pushSize = 1
      if (codecopyPushSize === null) {
        codecopyPushSize = 1
      }
    } else if (pushInstruction.opcode === 'PUSH2') {
      pushSize = 2
      if (codecopyPushSize === null) {
        codecopyPushSize = 2
      }
    }

    if (pushSize === 0) {
      throw new Error('only PUSH1 and PUSH2 opcodes are supported for now.')
    }

    if (codecopyPushSize !== pushSize) {
      throw new Error('size of PUSH opcodes must be consistent.')
    }

    // modify the relevant runtime code (TODO: ensure it doesn't overflow!)
    let modified = Buffer.from(
      (
        runtime.slice(
          pushInstruction.pc + 1,
          pushInstruction.pc + 1 + pushSize
        ).readUIntBE(0, pushSize) + preludeSize
      ).toString(16).padStart(2 * pushSize, '0'),
      'hex'
    )

    // update the runtime with the new modified code
    let runtimeSegments = [
      runtime.slice(0, pushInstruction.pc + 1),
      modified,
      runtime.slice(pushInstruction.pc + 1 + pushSize)
    ];
    runtime = Buffer.concat(runtimeSegments);
  })

  // Increase PUSH to CODECOPY length & RETURN in init code by prelude length
  let pushSize = 0
  if (initOps[candidate.sequenceStart].opcode === 'PUSH1') {
    pushSize = 1
  } else if (initOps[candidate.sequenceStart].opcode === 'PUSH2') {
    pushSize = 2
  }

  if (pushSize === 0) {
    throw new Error('only PUSH1 and PUSH2 opcodes are supported for now.')
  }

  runtimeLength = initOps[candidate.sequenceStart].pc

  // modify the relevant runtime code (TODO: ensure it doesn't overflow!)
  const modified = Buffer.from(
    (
      initCodeWithoutRuntime.slice(
        runtimeLength + 1,
        runtimeLength + 1 + pushSize
      ).readUIntBE(0, pushSize) + preludeSize
    ).toString(16).padStart(2 * pushSize, '0'),
    'hex'
  )

  // update the init code with the new modified length
  var initSegments = [
    initCodeWithoutRuntime.slice(0, runtimeLength + 1),
    modified,
    initCodeWithoutRuntime.slice(runtimeLength + 1 + pushSize)
  ];
  var updatedInitCode = Buffer.concat(initSegments);

  // concatenate new init code, prelude, and runtime code to get final init code
  var finalSegments = [updatedInitCode, prelude, runtime];
  var final = Buffer.concat(finalSegments);

  // get the final runtime code too
  var finalRuntimeSegments = [prelude, runtime];
  var finalRuntime = Buffer.concat(finalRuntimeSegments);

  // make the kakuna build directory if it doesn't currently exist
  if (!fs.existsSync('build/kakuna')) {
    fs.mkdir('build/kakuna', { recursive: true }, (err) => {
      if (err) throw err;
    });
  }

  // write new init code and runtime code to a file (along with some metadata)
  const out = JSON.stringify({
    contractName: contractName,
    prelude: preludeRaw,
    preludeSize: preludeSize,
    bytecode: '0x' + final.toString('hex'),
    deployedBytecode: '0x' + finalRuntime.toString('hex')
  }, null, 2)
  fs.writeFileSync(`build/kakuna/${contractName}.json`, out, {flag: 'w'})

  // Wow, it actually worked! Return kakuna'd initialization code & runtime code
  return ['0x' + final.toString('hex'), '0x' + finalRuntime.toString('hex')]
}}

/**
 * Modified implementation of the stack used in evm, where values are objects
 * rather than BN values. This is so we can deal with unknown stack items and
 * track whether the items are ever duplicated.
 */
class Stack {
  constructor () {
    this._store = []
  }

  get length () {
    return this._store.length
  }

  push (value) {
    if (this._store.length > 1023) {
      throw new Error("stack overflow")
    }

    if (!this._isValidValue(value)) {
      throw new Error("out of range")
    }
    if (value.duplicated !== true) {
      value.duplicated = false
    }
    this._store.push(value) // assign each {constant: false} a unique ID?
  }

  pop () {
    if (this._store.length < 1) {
      throw new Error("stack underflow")
    }

    return this._store.pop()
  }

  /**
   * Pop multiple items from stack. Top of stack is first item
   * in returned array.
   * @param {Number} num - Number of items to pop
   * @returns {Array}
   */
  popN (num = 1) {
    if (this._store.length < num) {
      throw new Error("stack underflow")
    }

    if (num === 0) {
      return []
    }

    return this._store.splice(-1 * num).reverse()
  }

  /**
   * Swap top of stack with an item in the stack.
   * @param {Number} position - Index of item from top of the stack (0-indexed)
   */
  swap (position) {
    if (this._store.length <= position) {
      throw new Error("stack underflow")
    }

    const head = this._store.length - 1
    const i = this._store.length - position - 1

    const tmp = this._store[head]
    this._store[head] = this._store[i]
    this._store[i] = tmp
  }

  /**
   * Pushes a copy of an item in the stack.
   * @param {Number} position - Index of item to be copied (1-indexed)
   */
  dup (position) {
    if (this._store.length < position) {
      throw new Error("stack underflow")
    }

    const i = this._store.length - position
    this._store[i].duplicated = true
    this.push(this._store[i])
  }

  _isValidValue (value) {
    if (BN.isBN(value.item)) {
      if (value.item.lte(utils.MAX_INTEGER)) {
        return true
      }
    } else if (Buffer.isBuffer(value.item)) {
      if (value.item.length <= 32) {
        return true
      }
    }

    return !value.constant
  }
}

// used to track the program counter and whether execution has halted.
class Counter {
  constructor () {
    this.instruction = 0
    this.stopped = false
  }

  jump (value) {
    this.instruction = value
  }

  increment () {
    this.instruction++
  }

  stop() {
    this.stopped = true
  }
}

// the functions that will operate on our modified stack for each opcode.
opFns = {
  JUMP: function (op, stack, counter) {
    let dest = stack.pop()

    // this means we found a jump constant.
    if (dest.constant && dest.origin) {
      if (
        typeof opsAndJumps[op.i].jump.dests === 'undefined' &&
        typeof opsAndJumps[op.i].jump.origins === 'undefined'
      ) {
        opsAndJumps[op.i].jump.dests = [{
          index: originalJumpdestIndexes[dest.item.toNumber()],
          pc: dest.item.toNumber()
        }]
        opsAndJumps[op.i].jump.origins = [{
          index: originalPushIndexes[dest.origin],
          pc: dest.origin,
          static: true,
          duplicated: dest.duplicated
        }]
      } else {
        const jumpdest = {
          index: originalJumpdestIndexes[dest.item.toNumber()],
          pc: dest.item.toNumber()
        }
        const origin = {
          index: originalPushIndexes[dest.origin],
          pc: dest.origin,
          static: true,
          duplicated: dest.duplicated
        }

        if (
          !(opsAndJumps[op.i].jump.dests
            .map(x => x.pc)
            .includes(jumpdest.pc)) &&
          !(opsAndJumps[op.i].jump.origins
            .map(x => x.pc)
            .includes(origin.pc))
        ) {
          opsAndJumps[op.i].jump.dests.push(jumpdest)
          opsAndJumps[op.i].jump.origins.push(origin)          
        }
      }

      // determine what instruction # the pc points to (ie no counting pushData)
      newInstruction = instructions[dest.item.toNumber()]

      // check that it points to a jumpdest
      if (opsAndJumps[newInstruction].opcode !== 'JUMPDEST') {
        throw new Error('selected jump does not point to a jumpdest.')
      }
      
      // alter instruction
      counter.jump(newInstruction)
    } else {
      console.log('DEBUG:', op, stack, counter)
      throw new Error('jump does not have a constant')
    }
  },
  JUMPI: function (op, stack, counter) {
    let [dest, cond] = stack.popN(2)

    // this means we found a jumpi constant.
    if (dest.constant) {
      if (
        typeof opsAndJumps[op.i].jump.dests === 'undefined' &&
        typeof opsAndJumps[op.i].jump.origins === 'undefined'
      ) {
        opsAndJumps[op.i].jump.dests = [{
          index: originalJumpdestIndexes[dest.item.toNumber()],
          pc: dest.item.toNumber()
        }]
        opsAndJumps[op.i].jump.origins = [{
          index: originalPushIndexes[dest.origin],
          pc: dest.origin,
          static: true,
          duplicated: dest.duplicated
        }]
      } else {
        const jumpdest = {
          index: originalJumpdestIndexes[dest.item.toNumber()],
          pc: dest.item.toNumber()
        }
        const origin = {
          index: originalPushIndexes[dest.origin],
          pc: dest.origin,
          static: true,
          duplicated: dest.duplicated
        }

        if (
          !(opsAndJumps[op.i].jump.dests
            .map(x => x.pc)
            .includes(jumpdest.pc)) &&
          !(opsAndJumps[op.i].jump.origins
            .map(x => x.pc)
            .includes(origin.pc))
        ) {
          opsAndJumps[op.i].jump.dests.push(jumpdest)
          opsAndJumps[op.i].jump.origins.push(origin)          
        }
      }

    } else {
      console.log('DEBUG:', op, stack, counter)
      throw new Error('jumpi does not have a constant')
    }

    if (!cond.constant) {
      throw new Error('cannot pass a non-constant as a JUMPI condition')
    }

    if (dest.constant && cond.constant && !cond.item.isZero()) {

      // determine what instruction # the pc points to (ie no counting pushData)
      newInstruction = instructions[dest.item.toNumber().toString()]

      // check that it points to a jumpdest
      if (opsAndJumps[newInstruction].opcode !== 'JUMPDEST') {
        throw new Error('selected jump does not point to a jumpdest.')
      }
      
      // alter instruction
      counter.jump(newInstruction)
    }
  },
  JUMPDEST: function (op, stack, counter) {},
  CODECOPY: function (op, stack, counter) {
    // this could be used as constants - requires working with memory
    let [memOffset, codeOffset, dataLength] = stack.popN(3)
  },
  POP: function (op, stack, counter) {
    stack.pop()
  },
  PUSH: function (op, stack, counter) {
    stack.push({constant: true, item: web3.utils.toBN('0x' + op.push.data), origin: op.pc})
  },
  DUP: function (op, stack, counter) {
    const stackPos = op.x - 127
    stack.dup(op.x - 127)
  },
  SWAP: function (op, stack, counter) {
    stack.swap(op.x - 143)
  },
  PC: function (op, stack, counter) {
    stack.push({constant: false}) // could set to true (op.pc) and transform?
  },
  MSIZE: function (op, stack, counter) {
    stack.push({constant: false})
  },
  STOP: function (op, stack, counter) {
    counter.stop()
  },
  ADD: function (op, stack, counter) {
    const [a, b] = stack.popN(2)
    let r
    if (a.constant && b.constant) {
      r = {constant: true, item: a.item.add(b.item).mod(utils.TWO_POW256)}
    } else {
      r = {constant: false}
    }
    
    stack.push(r)
  },
  MUL: function (op, stack, counter) {
    const [a, b] = stack.popN(2)
    let r
    if (a.constant && b.constant) {
      r = {constant: true, item: a.item.mul(b.item).mod(utils.TWO_POW256)}
    } else {
      r = {constant: false}
    }
    
    stack.push(r)
  },
  SUB: function (op, stack, counter) {
    const [a, b] = stack.popN(2)
    let r
    if (a.constant && b.constant) {
      r = {constant: true, item: a.item.sub(b.item).toTwos(256)}
    } else {
      r = {constant: false}
    }
    
    stack.push(r)
  },
  DIV: function (op, stack, counter) {
    const [a, b] = stack.popN(2)
    let r
    if (b.constant && b.item.isZero()) {     
      r = {constant: true, item: new BN(b.item)}
    } else if (a.constant && b.constant) {
      r = {constant: true, item: a.item.div(b.item)}
    } else {
      r = {constant: false}
    }
    
    stack.push(r)
  },
  SDIV: function (op, stack, counter) {
    let [a, b] = stack.popN(2)
    let r
    if (b.constant && b.item.isZero()) {
      r = {constant: true, item: new BN(b.item)}
    } else if (a.constant && b.constant) {
      x = a.item.fromTwos(256)
      y = b.item.fromTwos(256)
      r = {constant: true, item: x.div(y).toTwos(256)}
    } else {
      r = {constant: false}
    }

    stack.push(r)
  },
  MOD: function (op, stack, counter) {
    const [a, b] = stack.popN(2)
    let r
    if (b.constant && b.item.isZero()) {
      r = {constant: true, item: new BN(b.item)}
    } else if (a.constant && b.constant) {
      r = {constant: true, item: a.item.mod(b.item)}
    } else {
      r = {constant: false}
    }

    stack.push(r)
  },
  SMOD: function (op, stack, counter) {
    let [a, b] = stack.popN(2)
    let r
    if (b.constant && b.item.isZero()) {  
      r = {constant: true, item: new BN(b.item)}
    } else if (a.constant && b.constant) {
      x = a.item.fromTwos(256)
      y = b.item.fromTwos(256)
      z = x.abs().mod(y.abs())
      if (z.isNeg()) {
        z = z.ineg()
      }
      r = {constant: true, item: z.toTwos(256)}
    } else {
      r = {constant: false}
    }

    stack.push(r)
  },
  ADDMOD: function (op, stack, counter) {
    const [a, b, c] = stack.popN(3)
    let r
    if (c.constant && c.item.isZero()) {
      r = {constant: true, item: new BN(c.item)}
    } else if (a.constant && b.constant && c.constant) {
      r = a.item.add(b.item).mod(c.item)
    } else {
      r = {constant: false}
    }

    stack.push(r)
  },
  MULMOD: function (op, stack, counter) {
    const [a, b, c] = stack.popN(3)
    let r
    if (c.constant && c.item.isZero()) {
      r = {constant: true, item: new BN(c.item)}
    } else if (a.constant && b.constant && c.constant) {
      r = a.item.mul(b.item).mod(c.item)
    } else {
      r = {constant: false}
    }

    stack.push(r)
  },
  EXP: function (op, stack, counter) {
    let [base, exponent] = stack.popN(2)
    if (exponent.constant && exponent.item.isZero()) {
      stack.push({constant: true, item: new BN(1)})
      return
    }
    if (exponent.constant) {
      const byteLength = exponent.item.byteLength()
      if (byteLength < 1 || byteLength > 32) {
        throw new Error("out of range")
      }
    }

    if (base.constant && base.item.isZero()) {
      stack.push({constant: true, item: new BN(0)})
      return
    }

    let r
    if (base.constant && exponent.constant) {
      const m = BN.red(utils.TWO_POW256)
      b = base.item.toRed(m)
      r = {constant: true, item: b.redPow(exponent.item)}
    } else {
      r = {constant: false}
    }

    stack.push(r)
  },
  SIGNEXTEND: function (op, stack, counter) {
    let [k, val] = stack.popN(2)
    if (!k.constant || !val.constant) {
      stack.push({constant: false})
      return
    }
    val = val.item.toArrayLike(Buffer, 'be', 32)
    var extendOnes = false

    if (k.item.lten(31)) {
      k = k.item.toNumber()

      if (val[31 - k] & 0x80) {
        extendOnes = true
      }

      // 31-k-1 since k-th byte shouldn't be modified
      for (var i = 30 - k; i >= 0; i--) {
        val[i] = extendOnes ? 0xff : 0
      }
    }

    stack.push({constant: true, item: new BN(val)})
  },
  // 0x10 range - bit ops
  LT: function (op, stack, counter) {
    const [a, b] = stack.popN(2)
    if (!a.constant || !b.constant) {
      stack.push({constant: false})
      return
    }
    const r = {constant: true, item: new BN(a.item.lt(b.item) ? 1 : 0)}
    
    stack.push(r)
  },
  GT: function (op, stack, counter) {
    const [a, b] = stack.popN(2)
    if (!a.constant || !b.constant) {
      stack.push({constant: false})
      return
    }
    const r = {constant: true, item: new BN(a.item.gt(b.item) ? 1 : 0)}
    
    stack.push(r)
  },
  SLT: function (op, stack, counter) {
    const [a, b] = stack.popN(2)
    if (!a.constant || !b.constant) {
      stack.push({constant: false})
      return
    }
    const r = {
      constant: true,
      item: new BN(a.item.fromTwos(256).lt(b.item.fromTwos(256)) ? 1 : 0)
    }
    
    stack.push(r)
  },
  SGT: function (op, stack, counter) {
    const [a, b] = stack.popN(2)
    if (!a.constant || !b.constant) {
      stack.push({constant: false})
      return
    }
    const r = {
      constant: true,
      item: new BN(a.item.fromTwos(256).gt(b.item.fromTwos(256)) ? 1 : 0)
    }
    
    stack.push(r)
  },
  EQ: function (op, stack, counter) {
    const [a, b] = stack.popN(2)
    if (!a.constant || !b.constant) {
      stack.push({constant: false})
      return
    }
    const r = {constant: true, item: new BN(a.item.eq(b.item) ? 1 : 0)}
    
    stack.push(r)
  },
  ISZERO: function (op, stack, counter) {
    const a = stack.pop()
    if (!a.constant) {
      stack.push({constant: false})
      return
    }

    const r = {constant: true, item: new BN(a.item.isZero() ? 1 : 0)}
    
    stack.push(r)
  },
  AND: function (op, stack, counter) {
    const [a, b] = stack.popN(2)
    if (!a.constant || !b.constant) {
      stack.push({constant: false})
      return
    }

    const r = {constant: true, item: a.item.and(b.item)}
    
    stack.push(r)
  },
  OR: function (op, stack, counter) {
    const [a, b] = stack.popN(2)
    if (!a.constant || !b.constant) {
      stack.push({constant: false})
      return
    }

    const r = {constant: true, item: a.item.or(b.item)}
    
    stack.push(r)
  },
  XOR: function (op, stack, counter) {
    const [a, b] = stack.popN(2)
    if (!a.constant || !b.constant) {
      stack.push({constant: false})
      return
    }

    const r = {constant: true, item: a.item.xor(b.item)}
    
    stack.push(r)
  },
  NOT: function (op, stack, counter) {
    const a = stack.pop()
    if (!a.constant) {
      stack.push({constant: false})
      return
    }

    const r = {constant: true, item: a.item.notn(256)}
    
    stack.push(r)
  },
  BYTE: function (op, stack, counter) {
    const [pos, word] = stack.popN(2)
    if (pos.constant && pos.item.gten(32)) {
      stack.push({constant: true, item: new BN(0)})
      return
    }

    if (!pos.constant || !word.constant) {
      stack.push({constant: false})
      return
    }

    const r = {
      constant: true,
      item: new BN(word.item.shrn((31 - pos.item.toNumber()) * 8).andln(0xff))
    }

    stack.push(r)
  },
  SHL: function (op, stack, counter) {
    const [a, b] = stack.popN(2)
    // expects constantinople!
    if (a.constant && a.item.gten(256)) {
      stack.push(new BN(0))
      return
    }

    if (!a.constant || !b.constant) {
      stack.push({constant: false})
      return
    }

    const r = {
      constant: true,
      item: b.item.shln(a.item.toNumber()).iand(utils.MAX_INTEGER)
    }

    stack.push(r)
  },
  SHR: function (op, stack, counter) {
    const [a, b] = stack.popN(2)
    // expects constantinople!
    if (a.constant && a.item.gten(256)) {
      stack.push(new BN(0))
      return
    }

    if (!a.constant || !b.constant) {
      stack.push({constant: false})
      return
    }

    const r = {
      constant: true,
      item: b.item.shrn(a.item.toNumber()).iand(utils.MAX_INTEGER)
    }
    
    stack.push(r)
  },
  SAR: function (op, stack, counter) {
    const [a, b] = stack.popN(2)
    // expects constantinople!
    if (!a.constant || !b.constant) {
      stack.push({constant: false})
      return
    }

    let r
    const isSigned = b.item.testn(255)
    if (a.item.gten(256)) {
      if (isSigned) {
        r = {constant: true, item: new BN(utils.MAX_INTEGER)}
      } else {
        r = {constant: true, item: new BN(0)}
      }
      stack.push(r)
      return
    }

    const c = b.item.shrn(a.item.toNumber())
    if (isSigned) {
      const shiftedOutWidth = 255 - a.item.toNumber()
      const mask = utils.MAX_INTEGER.shrn(shiftedOutWidth).shln(shiftedOutWidth)
      r = {constant: true, item: c.ior(mask)}
    } else {
      r = {constant: true, item: c}
    }
    stack.push(r)
  },
  // 0x20 range - crypto
  SHA3: function (op, stack, counter) {
    const [offset, length] = stack.popN(2)

    stack.push({constant: false})
  },
  // 0x30 range - closure state
  ADDRESS: function (op, stack, counter) {
    stack.push({constant: false})
  },
  BALANCE: function (op, stack, counter) {
    let address = stack.pop()
    
    stack.push({constant: false})
  },
  ORIGIN: function (op, stack, counter) {
    stack.push({constant: false})
  },
  CALLER: function (op, stack, counter) {
    stack.push({constant: false})
  },
  CALLVALUE: function (op, stack, counter) {
    stack.push({constant: false})
  },
  CALLDATALOAD: function (op, stack, counter) {
    let pos = stack.pop()
    stack.push({constant: false})
  },
  CALLDATASIZE: function (op, stack, counter) {
    stack.push({constant: false})
  },
  CALLDATACOPY: function (op, stack, counter) {
    let [memOffset, dataOffset, dataLength] = stack.popN(3)
  },
  CODESIZE: function (op, stack, counter) {
    stack.push({constant: false})
  },
  EXTCODESIZE: function (op, stack, counter) {
    let address = stack.pop()
    stack.push({constant: false})
  },
  EXTCODECOPY: function (op, stack, counter) {
    let [address, memOffset, codeOffset, length] = stack.popN(4)
  },
  EXTCODEHASH: function (op, stack, counter) {
    let address = stack.pop()
    stack.push({constant: false})
  },
  RETURNDATASIZE: function (op, stack, counter) {
    stack.push({constant: false})
  },
  RETURNDATACOPY: function (op, stack, counter) {
    let [memOffset, returnDataOffset, length] = stack.popN(3)
  },
  GASPRICE: function (op, stack, counter) {
    stack.push({constant: false})
  },
  // '0x40' range - block operations
  BLOCKHASH: function (op, stack, counter) {
    const number = stack.pop()
    stack.push({constant: false})
  },
  COINBASE: function (op, stack, counter) {
    stack.push({constant: false})
  },
  TIMESTAMP: function (op, stack, counter) {
    stack.push({constant: false})
  },
  NUMBER: function (op, stack, counter) {
    stack.push({constant: false})
  },
  DIFFICULTY: function (op, stack, counter) {
    stack.push({constant: false})
  },
  GASLIMIT: function (op, stack, counter) {
    stack.push({constant: false})
  },

  MLOAD: function (op, stack, counter) {
    const pos = stack.pop()

    stack.push({constant: false})
  },
  MSTORE: function (op, stack, counter) {
    let [offset, word] = stack.popN(2)
  },
  MSTORE8: function (op, stack, counter) {
    let [offset, byte] = stack.popN(2)
  },
  SLOAD: function (op, stack, counter) {
    let key = stack.pop()
    stack.push({constant: false})
  },
  SSTORE: function (op, stack, counter) {
    // check for staticcall
    let [key, val] = stack.popN(2)
  },
  GAS: function (op, stack, counter) {
    stack.push({constant: false})
  },
  LOG: function (op, stack, counter) {
    // check for staticcall
    stack.popN(op.x - 158)
  },
  // '0xf0' range - closures
  CREATE: function (op, stack, counter) {
    // check for staticcall
    const [value, offset, length] = stack.popN(3)

    stack.push({constant: false})
  },
  CREATE2: function (op, stack, counter) {
    // check for constantinople

    // check for staticcall

    const [value, offset, length, salt] = stack.popN(4)

    stack.push({constant: false})
  },
  CALL: function (op, stack, counter) {
    let [gasLimit, toAddress, value, inOffset, inLength, outOffset, outLength] = stack.popN(7)
    
    stack.push({constant: false})
  },
  CALLCODE: function (op, stack, counter) {
    let [gasLimit, toAddress, value, inOffset, inLength, outOffset, outLength] = stack.popN(7)
    
    stack.push({constant: false})
  },
  DELEGATECALL: function (op, stack, counter) {
    let [gas, toAddress, inOffset, inLength, outOffset, outLength] = stack.popN(6)
    
    stack.push({constant: false})
  },
  STATICCALL: function (op, stack, counter) {
    let [gasLimit, toAddress, inOffset, inLength, outOffset, outLength] = stack.popN(6)
    
    stack.push({constant: false})
  },
  RETURN: function (op, stack, counter) {
    const [offset, length] = stack.popN(2)
    
    counter.stop()
  },
  REVERT: function (op, stack, counter) {
    const [offset, length] = stack.popN(2)

    counter.stop()
  },
  INVALID: function (op, stack, counter) {
    counter.stop()
  },
  SELFDESTRUCT: function (op, stack, counter) {
    let selfdestructToAddress = stack.pop()

    counter.stop()
  }
}

// used to get opcode information from a given opcode.
function opcodes (op, full, freeLogs) {
  const codes = {
    // 0x0 range - arithmetic ops
    // name, baseCost, off stack, on stack, dynamic, async
    0x00: ['STOP', 0, false],
    0x01: ['ADD', 3, false],
    0x02: ['MUL', 5, false],
    0x03: ['SUB', 3, false],
    0x04: ['DIV', 5, false],
    0x05: ['SDIV', 5, false],
    0x06: ['MOD', 5, false],
    0x07: ['SMOD', 5, false],
    0x08: ['ADDMOD', 8, false],
    0x09: ['MULMOD', 8, false],
    0x0a: ['EXP', 10, false],
    0x0b: ['SIGNEXTEND', 5, false],

    // 0x10 range - bit ops
    0x10: ['LT', 3, false],
    0x11: ['GT', 3, false],
    0x12: ['SLT', 3, false],
    0x13: ['SGT', 3, false],
    0x14: ['EQ', 3, false],
    0x15: ['ISZERO', 3, false],
    0x16: ['AND', 3, false],
    0x17: ['OR', 3, false],
    0x18: ['XOR', 3, false],
    0x19: ['NOT', 3, false],
    0x1a: ['BYTE', 3, false],
    0x1b: ['SHL', 3, false],
    0x1c: ['SHR', 3, false],
    0x1d: ['SAR', 3, false],

    // 0x20 range - crypto
    0x20: ['SHA3', 30, false],

    // 0x30 range - closure state
    0x30: ['ADDRESS', 2, true],
    0x31: ['BALANCE', 400, true, true],
    0x32: ['ORIGIN', 2, true],
    0x33: ['CALLER', 2, true],
    0x34: ['CALLVALUE', 2, true],
    0x35: ['CALLDATALOAD', 3, true],
    0x36: ['CALLDATASIZE', 2, true],
    0x37: ['CALLDATACOPY', 3, true],
    0x38: ['CODESIZE', 2, false],
    0x39: ['CODECOPY', 3, false],
    0x3a: ['GASPRICE', 2, false],
    0x3b: ['EXTCODESIZE', 700, true, true],
    0x3c: ['EXTCODECOPY', 700, true, true],
    0x3d: ['RETURNDATASIZE', 2, true],
    0x3e: ['RETURNDATACOPY', 3, true],
    0x3f: ['EXTCODEHASH', 400, true, true],

    // '0x40' range - block operations
    0x40: ['BLOCKHASH', 20, true, true],
    0x41: ['COINBASE', 2, true],
    0x42: ['TIMESTAMP', 2, true],
    0x43: ['NUMBER', 2, true],
    0x44: ['DIFFICULTY', 2, true],
    0x45: ['GASLIMIT', 2, true],

    // 0x50 range - 'storage' and execution
    0x50: ['POP', 2, false],
    0x51: ['MLOAD', 3, false],
    0x52: ['MSTORE', 3, false],
    0x53: ['MSTORE8', 3, false],
    0x54: ['SLOAD', 200, true, true],
    0x55: ['SSTORE', 0, true, true],
    0x56: ['JUMP', 8, false],
    0x57: ['JUMPI', 10, false],
    0x58: ['PC', 2, false],
    0x59: ['MSIZE', 2, false],
    0x5a: ['GAS', 2, false],
    0x5b: ['JUMPDEST', 1, false],

    // 0x60, range
    0x60: ['PUSH', 3, false],
    0x61: ['PUSH', 3, false],
    0x62: ['PUSH', 3, false],
    0x63: ['PUSH', 3, false],
    0x64: ['PUSH', 3, false],
    0x65: ['PUSH', 3, false],
    0x66: ['PUSH', 3, false],
    0x67: ['PUSH', 3, false],
    0x68: ['PUSH', 3, false],
    0x69: ['PUSH', 3, false],
    0x6a: ['PUSH', 3, false],
    0x6b: ['PUSH', 3, false],
    0x6c: ['PUSH', 3, false],
    0x6d: ['PUSH', 3, false],
    0x6e: ['PUSH', 3, false],
    0x6f: ['PUSH', 3, false],
    0x70: ['PUSH', 3, false],
    0x71: ['PUSH', 3, false],
    0x72: ['PUSH', 3, false],
    0x73: ['PUSH', 3, false],
    0x74: ['PUSH', 3, false],
    0x75: ['PUSH', 3, false],
    0x76: ['PUSH', 3, false],
    0x77: ['PUSH', 3, false],
    0x78: ['PUSH', 3, false],
    0x79: ['PUSH', 3, false],
    0x7a: ['PUSH', 3, false],
    0x7b: ['PUSH', 3, false],
    0x7c: ['PUSH', 3, false],
    0x7d: ['PUSH', 3, false],
    0x7e: ['PUSH', 3, false],
    0x7f: ['PUSH', 3, false],

    0x80: ['DUP', 3, false],
    0x81: ['DUP', 3, false],
    0x82: ['DUP', 3, false],
    0x83: ['DUP', 3, false],
    0x84: ['DUP', 3, false],
    0x85: ['DUP', 3, false],
    0x86: ['DUP', 3, false],
    0x87: ['DUP', 3, false],
    0x88: ['DUP', 3, false],
    0x89: ['DUP', 3, false],
    0x8a: ['DUP', 3, false],
    0x8b: ['DUP', 3, false],
    0x8c: ['DUP', 3, false],
    0x8d: ['DUP', 3, false],
    0x8e: ['DUP', 3, false],
    0x8f: ['DUP', 3, false],

    0x90: ['SWAP', 3, false],
    0x91: ['SWAP', 3, false],
    0x92: ['SWAP', 3, false],
    0x93: ['SWAP', 3, false],
    0x94: ['SWAP', 3, false],
    0x95: ['SWAP', 3, false],
    0x96: ['SWAP', 3, false],
    0x97: ['SWAP', 3, false],
    0x98: ['SWAP', 3, false],
    0x99: ['SWAP', 3, false],
    0x9a: ['SWAP', 3, false],
    0x9b: ['SWAP', 3, false],
    0x9c: ['SWAP', 3, false],
    0x9d: ['SWAP', 3, false],
    0x9e: ['SWAP', 3, false],
    0x9f: ['SWAP', 3, false],

    0xa0: ['LOG', 375, false],
    0xa1: ['LOG', 375, false],
    0xa2: ['LOG', 375, false],
    0xa3: ['LOG', 375, false],
    0xa4: ['LOG', 375, false],

    // '0xf0' range - closures
    0xf0: ['CREATE', 32000, true, true],
    0xf1: ['CALL', 700, true, true],
    0xf2: ['CALLCODE', 700, true, true],
    0xf3: ['RETURN', 0, false],
    0xf4: ['DELEGATECALL', 700, true, true],
    0xf5: ['CREATE2', 32000, true, true],
    0xfa: ['STATICCALL', 700, true, true],
    0xfd: ['REVERT', 0, false],

    // '0x70', range - other
    0xfe: ['INVALID', 0, false],
    0xff: ['SELFDESTRUCT', 5000, false, true]
  }

  var code = codes[op] ? codes[op] : ['INVALID', 0, false, false]
  var opcode = code[0]

  if (full) {
    if (opcode === 'LOG') {
      opcode += op - 0xa0
    }

    if (opcode === 'PUSH') {
      opcode += op - 0x5f
    }

    if (opcode === 'DUP') {
      opcode += op - 0x7f
    }

    if (opcode === 'SWAP') {
      opcode += op - 0x8f
    }
  }

  var fee = code[1]

  if (freeLogs) {
    if (opcode === 'LOG') {
      fee = 0
    }
  }

  return {name: opcode, opcode: op, fee: fee, dynamic: code[2], async: code[3]}
}

// used to get opcodes from raw bytes.
function nameOpCodes (raw) {
  operations = []
  var push = {data: ''}

  for (var i = 0; i < raw.length; i++) {
    var pc = i
    var curOpCode = opcodes(raw[pc], true).name

    // no destinations into the middle of PUSH
    if (curOpCode.slice(0, 4) === 'PUSH') {
      var jumpNum = raw[pc] - 0x5f
      push.data = raw.slice(pc + 1, pc + jumpNum + 1)
      i += jumpNum
    }

    operations.push({
      x: raw[pc],
      pc: pc,
      opcode: curOpCode,
      push: {data: push.data.toString('hex')}
    })

    push.data = ''
  }
  return operations
}

// used to calculate and verify the change in the stack size for each opcode.
function stackDelta(op) {
  const minusSix = [
    'LOG4',
    'CALL',
    'CALLCODE'
  ]

  const minusFive = [
    'LOG3',
    'DELEGATECALL',
    'STATICCALL'
  ]

  const minusFour = [
    'EXTCODECOPY',
    'LOG2'
  ]

  const minusThree = [
    'CALLDATACOPY',
    'CODECOPY',
    'RETURNDATACOPY',
    'LOG1',
    'CREATE2'
  ]

  const minusTwo = [
    'ADDMOD',
    'MULMOD',
    'MSTORE',
    'MSTORE8',
    'SSTORE',
    'JUMPI',
    'LOG0',
    'CREATE',
    'RETURN',
    'REVERT'
  ]

  const minusOne = [
    'ADD',
    'MUL',
    'SUB',
    'DIV',
    'SDIV',
    'MOD',
    'SMOD',
    'EXP',
    'SIGNEXTEND',
    'LT',
    'GT',
    'SLT',
    'SGT',
    'EQ',
    'AND',
    'OR',
    'XOR',
    'BYTE',
    'SHL',
    'SHR',
    'SAR',
    'SHA3',
    'POP',
    'JUMP',
    'SELFDESTRUCT'
  ]

  const zero = [
    'STOP',
    'ISZERO',
    'NOT',
    'BALANCE',
    'CALLDATALOAD',
    'EXTCODESIZE',
    'BLOCKHASH',
    'MLOAD',
    'SLOAD',
    'JUMPDEST',
    'SWAP', // 1-16
    'INVALID'

  ]
  const plusOne = [
    'ADDRESS',
    'ORIGIN',
    'CALLER',
    'CALLVALUE',
    'CALLDATASIZE',
    'CODESIZE',
    'GASPRICE',
    'RETURNDATASIZE',
    'COINBASE',
    'TIMESTAMP',
    'NUMBER',
    'DIFFICULTY',
    'GASLIMIT',
    'PC',
    'MSIZE',
    'GAS',
    'PUSH', // 1-32
    'DUP' // 1-16

  ]
  if (plusOne.includes(op.opcode)) return 1
  if (zero.includes(op.opcode)) return 0
  if (minusOne.includes(op.opcode)) return -1
  if (minusTwo.includes(op.opcode)) return -2
  if (minusThree.includes(op.opcode)) return -3
  if (minusFour.includes(op.opcode)) return -4
  if (minusFive.includes(op.opcode)) return -5
  if (minusSix.includes(op.opcode)) return -6
  if (op.opcode.includes('PUSH')) return 1
  if (op.opcode.includes('DUP')) return 1
  if (op.opcode.includes('SWAP')) return 0
  console.log('DEBUG:', op.opcode)
  throw new Error("cannot locate stack delta for given opcode") 
}

function pad (num, size) {
  var s = num + ''
  while (s.length < size) s = '0' + s
  return s
}

function log (num, base) {
  return Math.log(num) / Math.log(base)
} 

function roundLog (num, base) {
  return Math.ceil(log(num, base))
}