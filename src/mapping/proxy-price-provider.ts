import { Bytes, Address, log, ethereum, crypto } from '@graphprotocol/graph-ts';

import {
  AssetSourceUpdated,
  FallbackOracleUpdated,
  AaveOracle,
  WethSet,
} from '../../generated/AaveOracle/AaveOracle';
import { IExtendedPriceAggregator } from '../../generated/AaveOracle/IExtendedPriceAggregator';
import { GenericOracleI as FallbackPriceOracle } from '../../generated/AaveOracle/GenericOracleI';
import { AggregatorUpdated } from '../../generated/ChainlinkSourcesRegistry/ChainlinkSourcesRegistry';
import { ChainlinkENSResolver } from '../../generated/ChainlinkENSResolver/ChainlinkENSResolver';
import { OracleSystemMigrated } from '../../generated/schema';
import {
  ChainlinkAggregator as ChainlinkAggregatorContract,
  FallbackPriceOracle as FallbackPriceOracleContract,
  // UniswapExchange as UniswapExchangeContract,
} from '../../generated/templates';
import { byteArrayFromHex } from '../utils/converters';
import {
  getChainlinkAggregator,
  getOrInitPriceOracle,
  getPriceOracleAsset,
  getOrInitENS,
  getOrInitReserve,
} from '../helpers/initializers';
import {
  formatUsdEthChainlinkPrice,
  getPriceOracleAssetType,
  PRICE_ORACLE_ASSET_PLATFORM_UNISWAP,
  PRICE_ORACLE_ASSET_TYPE_SIMPLE,
  zeroAddress,
  zeroBI,
} from '../utils/converters';
import { MOCK_USD_ADDRESS, ZERO_ADDRESS } from '../utils/constants';
import {
  genericPriceUpdate,
  updateDependentAssets,
  usdEthPriceUpdate,
} from '../helpers/price-updates';
import { PriceOracle, PriceOracleAsset, WETHReserve } from '../../generated/schema';
import { IERC20Detailed } from '../../generated/templates/LendingPoolConfigurator/IERC20Detailed';

export function handleWethSet(event: WethSet): void {
  let wethAddress = event.params.weth;
  let weth = WETHReserve.load('weth');
  if (weth == null) {
    weth = new WETHReserve('weth');
  }
  weth.address = wethAddress;
  weth.name = 'WEthereum';
  weth.symbol = 'WETH';
  weth.decimals = 18;
  weth.updatedTimestamp = event.block.timestamp.toI32();
  weth.updatedBlockNumber = event.block.number;
  weth.save();
}

export function handleFallbackOracleUpdated(event: FallbackOracleUpdated): void {
  let priceOracle = getOrInitPriceOracle();

  priceOracle.fallbackPriceOracle = event.params.fallbackOracle;
  if (event.params.fallbackOracle.toHexString() != ZERO_ADDRESS) {
    FallbackPriceOracleContract.create(event.params.fallbackOracle);

    // update prices on assets which use fallback

    priceOracle.tokensWithFallback.forEach(token => {
      let priceOracleAsset = getPriceOracleAsset(token);
      if (
        priceOracleAsset.priceSource.equals(zeroAddress()) ||
        priceOracleAsset.isFallbackRequired
      ) {
        let proxyPriceProvider = AaveOracle.bind(event.address);
        let price = proxyPriceProvider.try_getAssetPrice(
          Bytes.fromHexString(priceOracleAsset.id) as Address
        );
        if (!price.reverted) {
          genericPriceUpdate(priceOracleAsset, price.value, event);
        } else {
          log.error(
            'OracleAssetId: {} | ProxyPriceProvider: {} | FallbackOracle: {} | EventAddress: {}',
            [
              priceOracleAsset.id,
              event.address.toHexString(),
              event.params.fallbackOracle.toHexString(),
              event.address.toHexString(),
            ]
          );
        }
      }
    });

    // update USDETH price
    let fallbackOracle = FallbackPriceOracle.bind(event.params.fallbackOracle);
    let ethUsdPrice = zeroBI();
    // try method for dev networks
    let ethUsdPriceCall = fallbackOracle.try_getEthUsdPrice();
    if (ethUsdPriceCall.reverted) {
      // try method for ropsten and mainnet
      ethUsdPrice = formatUsdEthChainlinkPrice(
        fallbackOracle.getAssetPrice(Address.fromString(MOCK_USD_ADDRESS))
      );
    } else {
      ethUsdPrice = ethUsdPriceCall.value;
    }
    if (
      priceOracle.usdPriceEthFallbackRequired ||
      priceOracle.usdPriceEthMainSource.equals(zeroAddress())
    ) {
      usdEthPriceUpdate(priceOracle, ethUsdPrice, event);
    }
  }
}

function priceProviderUpdated(
  event: ethereum.Event,
  assetAddress: Address,
  assetOracleAddress: Address,
  priceOracleAsset: PriceOracleAsset,
  priceOracle: PriceOracle
): void {
  // Check that oracle address exists
  let priceAggregatorInstance = IExtendedPriceAggregator.bind(assetOracleAddress);

  // // check is it composite or simple asset
  let tokenTypeCall = priceAggregatorInstance.try_getTokenType();
  if (!tokenTypeCall.reverted) {
    priceOracleAsset.type = getPriceOracleAssetType(tokenTypeCall.value);
    if (priceOracleAsset.type == PRICE_ORACLE_ASSET_TYPE_SIMPLE) {
      updateChainlinkAggregator(event);
    } else {
      priceOracleAsset.isFallbackRequired = false;

      // call contract and check on which assets we're dependent
      let dependencies = priceAggregatorInstance.getSubTokens();
      // add asset to all dependencies
      for (let i = 0; i < dependencies.length; i += 1) {
        let dependencyAddress = dependencies[i].toHexString();
        if (dependencyAddress == MOCK_USD_ADDRESS) {
          let usdDependentAssets = priceOracle.usdDependentAssets;
          if (!usdDependentAssets.includes(assetAddress.toHexString())) {
            usdDependentAssets.push(assetAddress.toHexString());
            priceOracle.usdDependentAssets = usdDependentAssets;
          }
        } else {
          let dependencyOracleAsset = getPriceOracleAsset(dependencyAddress);
          let dependentAssets = dependencyOracleAsset.dependentAssets;
          if (!dependentAssets.includes(assetAddress.toHexString())) {
            dependentAssets.push(assetAddress.toHexString());
            dependencyOracleAsset.dependentAssets = dependentAssets;
            dependencyOracleAsset.save();
          }
        }
      }
    }
  } else {
    log.error(`Couldn't get type from custom contract: {} | for token: {}`, [
      assetOracleAddress.toHexString(),
      assetAddress.toHexString(),
    ]);
    // TODO: maybe go directly to updateChainlinkAggregator? or leave as error?
  }

  //   2.1- if simple
  //      - it means its direct chainlink. Execute chainlink ens registry logic
  //   2.2- if complex
  //      - get dependant proxyies on and use this to listen to events / chainlink ens logic
}

// In charge of registering
function updateChainlinkAggregator(
  event: ethereum.Event,
  assetAddress: Address,
  aggregatorAddress: Address,
  priceOracleAsset: PriceOracleAsset
): void {
  // we can get the reserve as aave oracle is in the contractToPoolMapping as proxyPriceProvider
  let reserve = getOrInitReserve(assetAddress, event);
  let aToken = reserve.aToken;
  let ERC20ATokenContract = IERC20Detailed.bind(Bytes.fromHexString(aToken) as Address);
  let symbol = ERC20ATokenContract.symbol().slice(1); // TODO: remove slice if we change

  // Hash the ENS to generate the node and create the ENS register in the schema.
  let node = crypto
    .keccak256(byteArrayFromHex('aggregator.' + symbol + '-eth.data.eth'))
    .toHexString();

  // Create the ENS or update
  let ens = getOrInitENS(node);
  ens.aggregatorAddress = aggregatorAddress;
  ens.underlyingAddress = assetAddress;
  ens.symbol = symbol;
  ens.save();
  // Create watch for the new Chainlink aggregator
  ChainlinkAggregatorContract.create(aggregatorAddress);

  // update price oracle asset
  priceOracleAsset.priceSource = aggregatorAddress;
  priceOracleAsset.lastUpdateTimestamp = event.block.timestamp;

  // update the price from latestAnswer of new aggregator
  let priceAggregatorInstance = IExtendedPriceAggregator.bind(aggregatorAddress);
  let latestAnswerCall = priceAggregatorInstance.try_latestAnswer();
  if (!latestAnswerCall.reverted && latestAnswerCall.value.gt(zeroBI())) {
    priceOracleAsset.priceInEth = latestAnswerCall.value;
    // update dependants
    updateDependentAssets(priceOracleAsset.dependentAssets, event);
  } else {
    log.error(`Latest answer call failed on aggregator:: {} | for node:: {}`, [
      aggregatorAddress.toHexString(),
      node,
    ]);
    // TODO: Do I need to add fallback here?
    priceOracleAsset.isFallbackRequired = true;
  }

  priceOracleAsset.save();

  // create chainlinkAggregator entity with new aggregator to be able to match asset and oracle after
  let chainlinkAggregator = getChainlinkAggregator(aggregatorAddress.toHexString());
  chainlinkAggregator.oracleAsset = assetAddress.toHexString();
  chainlinkAggregator.save();
}

export function handleChainlinkAggregatorUpdated(event: AggregatorUpdated): void {
  let assetAddress = event.params.token;
  let assetOracleAddress = event.params.aggregator;

  let priceOracle = getOrInitPriceOracle();
  let priceOracleAsset = getPriceOracleAsset(assetAddress.toHexString());
  priceOracleAsset.fromChainlinkSourcesRegistry = true;
  let oracleMigrated = OracleSystemMigrated.load('1');
  if (oracleMigrated.activated == false) {
    chainLinkAggregatorUpdated(
      event,
      assetAddress,
      assetOracleAddress,
      priceOracleAsset,
      priceOracle
    );
  } else {
    updateChainlinkAggregator(event, assetAddress, assetOracleAddress, priceOracleAsset);
  }
}

export function handleAssetSourceUpdated(event: AssetSourceUpdated): void {
  let assetAddress = event.params.asset;
  let sAssetAddress = assetAddress.toHexString();
  let assetOracleAddress = event.params.source;
  // because of the bug with wrong assets addresses submission
  if (sAssetAddress.split('0').length > 38) {
    log.warning('skipping wrong asset registration {}', [sAssetAddress]);
    return;
  }
  let priceOracle = getOrInitPriceOracle();
  if (priceOracle.proxyPriceProvider.equals(zeroAddress())) {
    priceOracle.proxyPriceProvider = event.address;
  }

  let priceOracleAsset = getPriceOracleAsset(assetAddress.toHexString());

  let oracleMigrated = OracleSystemMigrated.load('1');
  if (oracleMigrated.activated) {
    priceProviderUpdated(event, assetAddress, assetOracleAddress, priceOracleAsset, priceOracle);
  } else {
    if (!priceOracleAsset.fromChainlinkSourcesRegistry) {
      chainLinkAggregatorUpdated(
        event,
        assetAddress,
        assetOracleAddress,
        priceOracleAsset,
        priceOracle
      );
    }
  }
}

function chainLinkAggregatorUpdated(
  event: ethereum.Event,
  assetAddress: Address,
  assetOracleAddress: Address,
  priceOracleAsset: PriceOracleAsset,
  priceOracle: PriceOracle
): void {
  let sAssetAddress = assetAddress.toHexString();

  let proxyPriceProvider = AaveOracle.bind(
    Address.fromString(priceOracle.proxyPriceProvider.toHexString())
  );

  //needed because of one wrong handleAssetSourceUpdated event deployed on the mainnet
  let priceFromProxy = zeroBI();

  let priceFromProxyCall = proxyPriceProvider.try_getAssetPrice(assetAddress);

  if (!priceFromProxyCall.reverted) {
    priceFromProxy = priceFromProxyCall.value;
  }

  priceOracleAsset.isFallbackRequired = true;

  // if it's valid oracle address
  if (!assetOracleAddress.equals(zeroAddress())) {
    let priceAggregatorInstance = IExtendedPriceAggregator.bind(assetOracleAddress);

    // // check is it composite or simple asset
    let tokenTypeCall = priceAggregatorInstance.try_getTokenType();
    if (!tokenTypeCall.reverted) {
      priceOracleAsset.type = getPriceOracleAssetType(tokenTypeCall.value);
    }

    if (priceOracleAsset.type == PRICE_ORACLE_ASSET_TYPE_SIMPLE) {
      // create ChainLink aggregator template entity
      ChainlinkAggregatorContract.create(assetOracleAddress);

      // fallback is not required if oracle works fine
      let priceAggregatorlatestAnswerCall = priceAggregatorInstance.try_latestAnswer();
      priceOracleAsset.isFallbackRequired =
        priceAggregatorlatestAnswerCall.reverted || priceAggregatorlatestAnswerCall.value.isZero();
    } else {
      // composite assets don't need fallback, it will work out of the box
      priceOracleAsset.isFallbackRequired = false;

      // call contract and check on which assets we're dependent
      let dependencies = priceAggregatorInstance.getSubTokens();
      // add asset to all dependencies
      for (let i = 0; i < dependencies.length; i += 1) {
        let dependencyAddress = dependencies[i].toHexString();
        if (dependencyAddress == MOCK_USD_ADDRESS) {
          let usdDependentAssets = priceOracle.usdDependentAssets;
          if (!usdDependentAssets.includes(sAssetAddress)) {
            usdDependentAssets.push(sAssetAddress);
            priceOracle.usdDependentAssets = usdDependentAssets;
          }
        } else {
          let dependencyOracleAsset = getPriceOracleAsset(dependencyAddress);
          let dependentAssets = dependencyOracleAsset.dependentAssets;
          if (!dependentAssets.includes(sAssetAddress)) {
            dependentAssets.push(sAssetAddress);
            dependencyOracleAsset.dependentAssets = dependentAssets;
            dependencyOracleAsset.save();
          }
        }
      }
      // if it's first oracle connected to this asset
      // commented until uniswap
      // if (priceOracleAsset.priceSource.equals(zeroAddress())) {
      //   // start listening on the platform updates
      //   if (priceOracleAsset.platform === PRICE_ORACLE_ASSET_PLATFORM_UNISWAP) {
      //     UniswapExchangeContract.create(assetAddress);
      //   }
      // }
    }

    // add entity to be able to match asset and oracle after
    let chainlinkAggregator = getChainlinkAggregator(assetOracleAddress.toHexString());
    chainlinkAggregator.oracleAsset = sAssetAddress;
    chainlinkAggregator.save();
  }
  // set price aggregator address
  priceOracleAsset.priceSource = assetOracleAddress;

  if (sAssetAddress == MOCK_USD_ADDRESS) {
    priceOracle.usdPriceEthFallbackRequired = priceOracleAsset.isFallbackRequired;
    priceOracle.usdPriceEthMainSource = assetOracleAddress;
    usdEthPriceUpdate(priceOracle, formatUsdEthChainlinkPrice(priceFromProxy), event);
  } else {
    // TODO: remove old one ChainLink aggregator template entity if it exists, and it's not fallback oracle
    // if chainlink was invalid before and valid now, remove from tokensWithFallback array
    if (
      !assetOracleAddress.equals(zeroAddress()) &&
      priceOracle.tokensWithFallback.includes(sAssetAddress) &&
      !priceOracleAsset.isFallbackRequired
    ) {
      priceOracle.tokensWithFallback = priceOracle.tokensWithFallback.filter(
        token => token != assetAddress.toHexString()
      );
    }

    if (
      !priceOracle.tokensWithFallback.includes(sAssetAddress) &&
      (assetOracleAddress.equals(zeroAddress()) || priceOracleAsset.isFallbackRequired)
    ) {
      let updatedTokensWithFallback = priceOracle.tokensWithFallback;
      updatedTokensWithFallback.push(sAssetAddress);
      priceOracle.tokensWithFallback = updatedTokensWithFallback;
    }
    priceOracle.save();

    genericPriceUpdate(priceOracleAsset, priceFromProxy, event);
  }
}
