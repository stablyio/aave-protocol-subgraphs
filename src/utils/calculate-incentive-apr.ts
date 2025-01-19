import { BigDecimal, BigInt, log } from '@graphprotocol/graph-ts';
import { ETH_PRECISION, SECONDS_PER_YEAR } from './constants';

export interface CalculateIncentiveAPRRequest {
  emissionPerSecond: BigInt;
  rewardTokenPriceInMarketReferenceCurrency: BigInt; // Can be priced in ETH or USD depending on market
  totalTokenSupply: BigInt;
  priceInMarketReferenceCurrency: BigInt; // Can be priced in ETH or USD depending on market
  decimals: BigInt;
  rewardTokenDecimals: BigInt;
}

// Calculate the APR for an incentive emission
// export function calculateIncentiveAPR({
//   emissionPerSecond,
//   rewardTokenPriceInMarketReferenceCurrency,
//   priceInMarketReferenceCurrency,
//   totalTokenSupply,
//   decimals,
//   rewardTokenDecimals,
// }: CalculateIncentiveAPRRequest): BigDecimal
export function calculateIncentiveAPR(
  emissionPerSecond: BigInt,
  rewardTokenPriceInMarketReferenceCurrency: BigInt, // Can be priced in ETH or USD depending on market
  totalTokenSupply: BigInt,
  priceInMarketReferenceCurrency: BigInt, // Can be priced in ETH or USD depending on market
  decimals: BigInt,
  rewardTokenDecimals: BigInt
): BigDecimal {
  // const rewardTokenDecimalsPow = BigInt.fromI32(10)
  //   .pow(rewardTokenDecimals.toU32())
  //   .toBigDecimal();
  // const decimalsPow = BigInt.fromI32(10)
  //   .pow(decimals.toU32())
  //   .toBigDecimal();

  const rewardTokenPriceNormalized = rewardTokenPriceInMarketReferenceCurrency
    .toBigDecimal()
    // .div(ETH_PRECISION);
  const emissionPerSecondNormalized = emissionPerSecond
    .toBigDecimal()
    .truncate(rewardTokenDecimals.toI32())
    .times(rewardTokenPriceNormalized);

  if (emissionPerSecondNormalized.equals(BigDecimal.zero())) {
    return BigDecimal.zero();
  }

  const emissionPerYear = emissionPerSecondNormalized.times(SECONDS_PER_YEAR.toBigDecimal());

  const priceInMarketReferenceCurrencyNormalized = priceInMarketReferenceCurrency
    .toBigDecimal()
    // .div(ETH_PRECISION);
  const totalSupplyNormalized = totalTokenSupply
    .toBigDecimal()
    .truncate(decimals.toI32())
    .times(priceInMarketReferenceCurrencyNormalized);

  const result = emissionPerYear.div(totalSupplyNormalized);

  log.info(`calculateIncentiveAPR {} {} {} {} {} {} {} {}`, [
    emissionPerSecondNormalized.toString(),
    rewardTokenDecimals.toString(),
    rewardTokenPriceNormalized.toString(),
    totalTokenSupply.toString(),
    decimals.toString(),
    totalSupplyNormalized.toString(),
    priceInMarketReferenceCurrencyNormalized.toString(),
    result.toString(),
  ]);

  return result;
}
