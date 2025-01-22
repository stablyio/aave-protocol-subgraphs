import { BigInt } from '@graphprotocol/graph-ts';

export const SECONDS_PER_YEAR = BigInt.fromString('31536000');
export const SECONDS_PER_HOUR = 60 * 60; // 3600

export const MOCK_ETHEREUM_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
export const MOCK_USD_ADDRESS = '0x4d6e79013212f10a026a1fb0b926c9fd0432b96c';
export const PROPOSAL_STATUS_INITIALIZING = 'Initializing';
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const ETH_PRECISION_DECIMALS = BigInt.fromI32(18);
export const ETH_PRECISION = BigInt.fromI32(10).pow(18);
export const USD_PRECISION = BigInt.fromI32(10).pow(8).toBigDecimal();
