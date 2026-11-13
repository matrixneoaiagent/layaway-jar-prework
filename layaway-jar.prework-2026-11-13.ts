import type { XOTemplate } from '@xo-cash/types';

/**
 * Layaway Jar
 *
 * A single-saver savings jar that accumulates BCH toward a fixed purchase
 * target and pays a fixed merchant when the target is reached.
 *
 * The on-chain covenant is a P2SH32 redeem script. The jar's current balance
 * is the value of the covenant UTXO itself, so every state transition is
 * enforced by the value and bytecode of the next output:
 *
 * - deposit: output 0 must pay the same covenant (bytecode equality), with a
 *   strictly larger value. This carries the jar state (balance + target +
 *   merchant + saver) forward.
 * - release: output 0 must pay the merchant locking script exactly the target
 *   amount, and the jar input must already hold at least the target. Extra
 *   satoshis are returned to the saver by a second output.
 * - refund: output 0 must pay the saver locking script, with at most
 *   maxRefundFeeSatoshis taken for the miner fee.
 *
 * Every path also requires a Schnorr signature from the saver key that was
 * generated for the jar and stored as role state by the engine.
 */
export const layawayJarTemplate: XOTemplate = {
    $schema: 'https://libauth.org/schemas/wallet-template-v0.schema.json',

    name: 'Layaway Jar',
    description: 'Save BCH toward a fixed target and release it to a merchant, or refund it to the saver.',
    icon: 'jar',

    version: '1',
    supported: [ 'BCH_2023_05', 'BCH_2024_05', 'BCH_2025_05', 'BCH_2026_05' ],

    resources: [
        {
            name: 'XO template documentation',
            description: 'Guide to writing XO templates.',
            url: 'https://stack.xo.cash/blog/2026-08-24-Vision-to-Reality-6-Writing-Templates.html',
        },
    ],

    roles: {
        saver: {
            name: 'Saver',
            description: 'The person saving toward the target. Holds the key that authorizes deposits, release and refund.',
            icon: 'saver',
        },
    },

    start: [
        {
            action: 'createJar',
            role: 'saver',
            generate: [ 'saverKey' ],
        },
    ],

    actions: {
        createJar: {
            name: 'Create Layaway Jar',
            description: 'Start a jar with a target, a merchant and an initial deposit.',
            icon: 'jar',

            roles: {
                saver: {
                    name: 'Create jar',
                    description: 'Choose the target and merchant, and make the first deposit.',
                    icon: 'saver',

                    generate: [ 'saverKey' ],

                    requirements: {
                        variables: [ 'jarSatoshis', 'targetSatoshis', 'merchantLockingScript', 'saverLockingScript' ],
                    },
                },
            },

            requirements: {
                participants: [
                    { role: 'saver', slots: { min: 1, max: 1 } },
                ],
            },

            transaction: 'createJarTransaction',
        },

        deposit: {
            name: 'Deposit',
            description: 'Add satoshis to the jar. The same jar covenant is carried forward with a larger balance.',
            icon: 'deposit',

            roles: {
                saver: {
                    requirements: {
                        variables: [ 'jarSatoshis', 'depositedSatoshis', 'targetSatoshis', 'merchantLockingScript', 'saverLockingScript' ],
                        secrets: [ 'saverKey' ],
                    },
                },
            },

            requirements: {
                participants: [
                    { role: 'saver', slots: { min: 1, max: 1 } },
                ],
            },

            transaction: 'depositTransaction',
        },

        release: {
            name: 'Release to Merchant',
            description: 'Pay the merchant the target amount once the jar holds at least the target.',
            icon: 'release',

            roles: {
                saver: {
                    requirements: {
                        variables: [ 'jarSatoshis', 'targetSatoshis', 'merchantLockingScript', 'saverLockingScript' ],
                        secrets: [ 'saverKey' ],
                    },
                },
            },

            requirements: {
                participants: [
                    { role: 'saver', slots: { min: 1, max: 1 } },
                ],
            },

            // Only offered when the jar holds enough to pay the target, the
            // template fee, and leave a non-dust refund for the saver.
            conditions: [
                '$(OP_INPUTINDEX OP_UTXOVALUE <targetSatoshis> <minerFeeSatoshis> OP_ADD <dustLimit> OP_ADD OP_GREATERTHANOREQUAL)',
            ],

            transaction: 'releaseTransaction',
        },

        refund: {
            name: 'Refund to Saver',
            description: 'Return the jar balance to the saver and close the jar.',
            icon: 'refund',

            roles: {
                saver: {
                    requirements: {
                        // All immutable jar scripts/values are required on every
                        // follow-up so the unlock redeem script is compiled from
                        // the same values as the locking script. The engine stores
                        // state variables as strings, and a satoshi value that is
                        // not supplied here would be encoded as text instead of a
                        // VM number.
                        variables: [ 'jarSatoshis', 'targetSatoshis', 'merchantLockingScript', 'saverLockingScript' ],
                        secrets: [ 'saverKey' ],
                    },
                },
            },

            requirements: {
                participants: [
                    { role: 'saver', slots: { min: 1, max: 1 } },
                ],
            },

            transaction: 'refundTransaction',
        },
    },

    transactions: {
        createJarTransaction: {
            name: 'Layaway Jar Created',
            description: 'Created a layaway jar with an initial balance of $(<jarSatoshis>) satoshis and a target of $(<targetSatoshis>) satoshis.',
            icon: 'jar',

            inputs: [],
            outputs: [
                { output: 'initialJarOutput', outputIndex: 0 },
            ],

            version: 2,
            locktime: 0,
            composable: true,
        },

        depositTransaction: {
            name: 'Jar Deposit',
            description: 'Added $(<depositedSatoshis>) satoshis to the jar, bringing it to $(<jarSatoshis> <depositedSatoshis> OP_ADD) satoshis.',
            icon: 'deposit',

            inputs: [
                { input: 'jarInput', inputIndex: 0 },
            ],
            outputs: [
                { output: 'depositJarOutput', outputIndex: 0 },
            ],

            version: 2,
            locktime: 0,
            composable: true,
        },

        releaseTransaction: {
            name: 'Jar Released',
            description: 'Released $(<targetSatoshis>) satoshis to the merchant. The remaining jar balance returned to the saver.',
            icon: 'release',

            inputs: [
                { input: 'jarInput', inputIndex: 0 },
            ],
            outputs: [
                { output: 'merchantOutput', outputIndex: 0 },
                { output: 'releaseRefundOutput', outputIndex: 1 },
            ],

            version: 2,
            locktime: 0,
            composable: true,
        },

        refundTransaction: {
            name: 'Jar Refunded',
            description: 'Refunded the jar balance to the saver.',
            icon: 'refund',

            inputs: [
                { input: 'jarInput', inputIndex: 0 },
            ],
            outputs: [
                { output: 'refundOutput', outputIndex: 0 },
            ],

            version: 2,
            locktime: 0,
            composable: true,
        },
    },

    inputs: {
        jarInput: {
            name: 'Jar balance',
            description: 'The layaway jar covenant output holding $(<jarSatoshis>) satoshis.',
            icon: 'jar',

            valueSatoshis: '$(<jarSatoshis>)',
            token: null,
            unlockingScript: 'unlockJar',
        },
    },

    outputs: {
        initialJarOutput: {
            name: 'Layaway Jar',
            description: 'A new jar holding $(<jarSatoshis>) satoshis toward a target of $(<targetSatoshis>) satoshis.',
            icon: 'jar',

            lockingScript: 'jarScript',
            valueSatoshis: '$(<jarSatoshis>)',
            token: null,
        },

        depositJarOutput: {
            name: 'Layaway Jar',
            description: 'The jar carried forward with $(<jarSatoshis> <depositedSatoshis> OP_ADD) satoshis.',
            icon: 'jar',

            lockingScript: 'jarScript',
            valueSatoshis: '$(<jarSatoshis> <depositedSatoshis> OP_ADD)',
            token: null,
        },

        merchantOutput: {
            name: 'Merchant payment',
            description: 'The merchant receives the $(<targetSatoshis>) satoshi target.',
            icon: 'merchant',

            lockingScript: '$(<merchantLockingScript>)',
            valueSatoshis: '$(<targetSatoshis>)',
            token: null,
        },

        releaseRefundOutput: {
            name: 'Saver refund',
            description: 'The part of the jar above the target returns to the saver.',
            icon: 'refund',

            lockingScript: '$(<saverLockingScript>)',
            valueSatoshis: '$(<jarSatoshis> <targetSatoshis> OP_SUB <minerFeeSatoshis> OP_SUB)',
            token: null,
        },

        refundOutput: {
            name: 'Saver refund',
            description: 'The jar balance returns to the saver.',
            icon: 'refund',

            lockingScript: '$(<saverLockingScript>)',
            valueSatoshis: '$(<jarSatoshis> <minerFeeSatoshis> OP_SUB)',
            token: null,
        },
    },

    lockingScripts: {
        jarScript: {
            name: 'Layaway Jar Covenant',
            description: 'Holds the jar balance and enforces deposit, merchant release and saver refund.',
            icon: 'jar',

            lockingType: 'p2sh',
            lockingBytecode: 'jarRedeemBytecode',
            unlockingBytecode: 'unlockJar',

            // These values are embedded in the redeem script. jarSatoshis is
            // tracked as state for user interfaces; the authoritative balance
            // is the value of the covenant UTXO.
            state: {
                variables: [ 'jarSatoshis', 'targetSatoshis', 'merchantLockingScript', 'saverLockingScript' ],
                secrets: [],
            },

            roles: {
                saver: {
                    state: {
                        variables: [],
                        secrets: [ 'saverKey' ],
                    },

                    actions: [
                        { action: 'deposit', role: 'saver', secrets: [{ saverKey: null }] },
                        { action: 'release', role: 'saver', secrets: [{ saverKey: null }] },
                        { action: 'refund', role: 'saver', secrets: [{ saverKey: null }] },
                    ],

                    balance: {
                        satoshis: true,
                    },

                    // The jar is only spent through its explicit follow-up actions.
                    selectable: false,
                },
            },
        },
    },

    scripts: {
        // P2SH32 unlocking entries. The engine appends the redeem script.
        unlockJar: '<saverKey.schnorr_signature.all_outputs> <saverKey.public_key>',

        // Hash of the saver public key, used by the P2PKH style signature check.
        saverPublicKeyHash: '<saverKey.public_key> OP_HASH160',

        // Require the saver signature on every spend path.
        enforceSaverSignature: 'OP_DUP OP_HASH160 saverPublicKeyHash OP_EQUALVERIFY OP_CHECKSIGVERIFY',

        // Deposit: the same covenant bytecode must continue with a larger value.
        enforceDeposit:
            'OP_0 OP_OUTPUTVALUE OP_BIN2NUM OP_INPUTINDEX OP_UTXOVALUE OP_BIN2NUM OP_GREATERTHAN OP_VERIFY OP_1',

        // Release: the jar must already hold the target and must pay the
        // merchant exactly the target.
        enforceRelease:
            'OP_INPUTINDEX OP_UTXOVALUE OP_BIN2NUM <targetSatoshis> OP_GREATERTHANOREQUAL OP_VERIFY OP_0 OP_OUTPUTVALUE OP_BIN2NUM <targetSatoshis> OP_NUMEQUAL OP_VERIFY OP_1',

        // Refund: pay the saver script, allowing at most 1000 satoshis of fee.
        // NOTE: The limit is inlined because Libauth's compiler does not
        // expose template constants inside covenant scripts. The constant
        // below documents the same limit for output expressions.
        enforceRefund:
            'OP_0 OP_OUTPUTBYTECODE <saverLockingScript> OP_EQUALVERIFY OP_0 OP_OUTPUTVALUE OP_BIN2NUM OP_INPUTINDEX OP_UTXOVALUE OP_BIN2NUM <1000> OP_SUB OP_GREATERTHANOREQUAL OP_VERIFY OP_1',

        // If output 0 is the merchant, take the release path. Otherwise take
        // the refund path. Release is checked first so a merchant script that
        // happens to equal the saver script cannot bypass the target check.
        enforceMerchantOrRefund:
            'OP_0 OP_OUTPUTBYTECODE <merchantLockingScript> OP_EQUAL OP_IF enforceRelease OP_ELSE enforceRefund OP_ENDIF',

        // If output 0 is the same covenant, take the deposit path.
        enforceJarRules:
            'OP_0 OP_OUTPUTBYTECODE OP_INPUTINDEX OP_UTXOBYTECODE OP_EQUAL OP_IF enforceDeposit OP_ELSE enforceMerchantOrRefund OP_ENDIF',

        // The full redeem script. Every spend path must satisfy the saver
        // signature and one of the three state transitions.
        jarRedeemBytecode: 'enforceSaverSignature enforceJarRules',
    },

    constants: {
        minerFeeSatoshis: {
            name: 'Miner fee',
            description: 'Miner fee allowed by the release and refund outputs.',
            type: 'satoshis',
            value: 500n,
        },
        maxRefundFeeSatoshis: {
            name: 'Maximum refund fee',
            description: 'The most a refund transaction may take from the jar as a miner fee.',
            type: 'satoshis',
            value: 1000n,
        },
        dustLimit: {
            name: 'Dust limit',
            description: 'Minimum value of the refund output.',
            type: 'satoshis',
            value: 546n,
        },
    },

    variables: {
        saverKey: {
            name: 'Saver key',
            description: 'The key that authorizes deposits, release and refund.',
            type: 'private_key',
        },
        jarSatoshis: {
            name: 'Jar balance',
            description: 'The current number of satoshis held by the jar.',
            type: 'satoshis',
        },
        depositedSatoshis: {
            name: 'Deposit amount',
            description: 'The number of satoshis to add to the jar.',
            type: 'satoshis',
        },
        targetSatoshis: {
            name: 'Target',
            description: 'The number of satoshis the jar must hold before it can be released to the merchant.',
            type: 'satoshis',
        },
        merchantLockingScript: {
            name: 'Merchant',
            description: 'The locking script that receives the target when the jar is released.',
            type: 'locking_script',
        },
        saverLockingScript: {
            name: 'Saver destination',
            description: 'The locking script that receives refunds and any amount above the target.',
            type: 'locking_script',
        },
    },

    icons: [
        { name: 'jar', hash: '0000000000000000000000' },
        { name: 'saver', hash: '0000000000000000000000' },
        { name: 'deposit', hash: '0000000000000000000000' },
        { name: 'release', hash: '0000000000000000000000' },
        { name: 'refund', hash: '0000000000000000000000' },
        { name: 'merchant', hash: '0000000000000000000000' },
    ],
};
