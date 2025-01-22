import { BigInt, log } from '@graphprotocol/graph-ts';
import { ETH_PRECISION_DECIMALS, SECONDS_PER_YEAR } from './constants';
import { rayDiv, wadToRay } from '../helpers/math';
import { exponentToBigInt } from './converters';

export interface CalculateIncentiveAPRRequest {
  emissionPerSecond: BigInt;
  rewardTokenPriceInMarketReferenceCurrency: BigInt; // Can be priced in ETH or USD depending on market
  totalTokenSupply: BigInt;
  priceInMarketReferenceCurrency: BigInt; // Can be priced in ETH or USD depending on market
  decimals: BigInt;
  rewardTokenDecimals: BigInt;
}

// Calculate the APR for an incentive emission
export function calculateIncentiveAPR(
  emissionPerSecond: BigInt, // number of tokens issued every second (not was, not RAY)
  rewardTokenPriceInMarketReferenceCurrency: BigInt, // Can be priced in ETH or USD depending on market (WAD)
  totalTokenSupply: BigInt, // WAD
  priceInMarketReferenceCurrency: BigInt, // Can be priced in ETH or USD depending on market (WAD)
  decimals: BigInt,
  rewardTokenDecimals: BigInt
): BigInt {
  const rewardTokenDecimalDiff = ETH_PRECISION_DECIMALS.minus(rewardTokenDecimals);
  const targetTokenDecimalDiff = ETH_PRECISION_DECIMALS.minus(decimals);
  const rewardTokenDecimalDiffWad = exponentToBigInt(rewardTokenDecimalDiff.toI32())
  const targetTokenDecimalDiffWad = exponentToBigInt(targetTokenDecimalDiff.toI32())
  
  const emissionPerSecondWAD = emissionPerSecond
    // multiply the price of the token in ETH unit
    .times(rewardTokenPriceInMarketReferenceCurrency)
    // convert emissionPerSecond to WAD
    .times(rewardTokenDecimalDiffWad);

  if (emissionPerSecondWAD.isZero()) {
    // log.info(`calculateIncentiveAPR zero {} {} {} {} {}`, [
    //   rewardTokenDecimalDiff.toString(),
    //   targetTokenDecimalDiff.toString(),
    //   emissionPerSecondWAD.toString(),
    //   rewardTokenPriceInMarketReferenceCurrency.toString(),
    //   rewardTokenDecimalDiffWad.toString(),
    //   targetTokenDecimalDiffWad.toString()
    // ]);
    return BigInt.zero();
  }

  const emissionPerYearWAD = emissionPerSecondWAD.times(SECONDS_PER_YEAR);


  const totalSupplyWAD = totalTokenSupply
    .times(priceInMarketReferenceCurrency)
    .times(targetTokenDecimalDiffWad);

  // Convert WAD to RAY before dividing
  const result = rayDiv(wadToRay(emissionPerYearWAD), wadToRay(totalSupplyWAD));

  // log.info(`calculateIncentiveAPR {} {} {} {} {} {} {} {} {} {}`, [
  //   rewardTokenDecimalDiff.toString(),
  //   targetTokenDecimalDiff.toString(),
  //   emissionPerSecondWAD.toString(),
  //   emissionPerYearWAD.toString(),
  //   wadToRay(emissionPerYearWAD).toString(),
  //   totalTokenSupply.toString(),
  //   totalSupplyWAD.toString(),
  //   result.toString(),
  //   rewardTokenPriceInMarketReferenceCurrency.toString(),
  //   priceInMarketReferenceCurrency.toString()
  // ]);

  // convert the normal value into
  return result;
}
