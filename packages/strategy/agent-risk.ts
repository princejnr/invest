import { SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";
import { LogicContext } from "./indicators.ts";

export type RiskValidationResult = {
  valid: boolean;
  reason?: string;
};

const CORRELATION_GROUPS: Record<string, { group: string, weight: number }> = {
  // US Dollar Basket
  'EURUSD': { group: 'USD', weight: -1 },
  'GBPUSD': { group: 'USD', weight: -1 },
  'AUDUSD': { group: 'USD', weight: -1 },
  'NZDUSD': { group: 'USD', weight: -1 },
  'XAUUSD': { group: 'USD', weight: -1 },
  'XAGUSD': { group: 'USD', weight: -1 },
  'BTCUSD': { group: 'USD', weight: -1 },
  'USDJPY': { group: 'USD', weight: 1 },
  'USDCHF': { group: 'USD', weight: 1 },
  'USDCAD': { group: 'USD', weight: 1 },

  // Global Equity Indices Basket
  'US30':   { group: 'EQUITY_INDICES', weight: 1 },
  'NAS100': { group: 'EQUITY_INDICES', weight: 1 },
  'SPX500': { group: 'EQUITY_INDICES', weight: 1 },
  'GER30':  { group: 'EQUITY_INDICES', weight: 1 },

  // Energy Basket
  'UKOIL':  { group: 'ENERGY', weight: 1 },
  'USOIL':  { group: 'ENERGY', weight: 1 },

  // JPY Crosses Basket
  'GBPJPY': { group: 'JPY_CROSSES', weight: 1 },
  'EURJPY': { group: 'JPY_CROSSES', weight: 1 },
  'CADJPY': { group: 'JPY_CROSSES', weight: 1 },
};

// Currency Exposure Decomposition Map (Base and Quote)
const CURRENCY_DECOMPOSITION: Record<string, { base: string, quote: string }> = {
  EURUSD: { base: 'EUR', quote: 'USD' },
  GBPUSD: { base: 'GBP', quote: 'USD' },
  AUDUSD: { base: 'AUD', quote: 'USD' },
  NZDUSD: { base: 'NZD', quote: 'USD' },
  USDJPY: { base: 'USD', quote: 'JPY' },
  USDCHF: { base: 'USD', quote: 'CHF' },
  USDCAD: { base: 'USD', quote: 'CAD' },
  EURJPY: { base: 'EUR', quote: 'JPY' },
  GBPJPY: { base: 'GBP', quote: 'JPY' },
  CADJPY: { base: 'CAD', quote: 'JPY' },
  EURGBP: { base: 'EUR', quote: 'GBP' },
  XAUUSD: { base: 'XAU', quote: 'USD' },
  XAGUSD: { base: 'XAG', quote: 'USD' },
  BTCUSD: { base: 'BTC', quote: 'USD' },
  ETHUSD: { base: 'ETH', quote: 'USD' },
};

export const ASSET_CONTRACT_SIZES: Record<string, number> = {
  XAGUSD: 5000,
  UKOIL: 1000,
  USOIL: 1000,
  XAUUSD: 100,
  US30: 1,
  NAS100: 1,
  SPX500: 1,
  GER30: 1,
  BTCUSD: 1,
  ETHUSD: 1,
  EURUSD: 100000,
  GBPUSD: 100000,
  USDJPY: 100000,
  AUDUSD: 100000,
  NZDUSD: 100000,
  USDCAD: 100000,
  USDCHF: 100000,
  EURJPY: 100000,
  GBPJPY: 100000,
};

// Validates that stop loss distance on candidate trades does not exceed the 2.0% account blowout cap at 0.01 lot
export function validateAccountStopBounds(
  symbol: string,
  entryPrice: number,
  stopLoss: number,
  portfolioCapital: number = 1020.0
): RiskValidationResult {
  const contractSize = ASSET_CONTRACT_SIZES[symbol] || 1;
  const minLot = 0.01;
  const maxRiskPct = 0.02; // 2.0% max loss per trade at minimum lot
  const maxDollarLoss = portfolioCapital * maxRiskPct;

  let pointValueUsd = contractSize;
  if (symbol.endsWith("JPY") && entryPrice > 0) {
    pointValueUsd = contractSize / entryPrice;
  } else if (symbol === "GER30") {
    pointValueUsd = contractSize * 1.1;
  }

  const stopDistance = Math.abs(entryPrice - stopLoss);
  const minLotDollarRisk = stopDistance * minLot * pointValueUsd;

  if (minLotDollarRisk > maxDollarLoss) {
    const maxStopDist = maxDollarLoss / (minLot * pointValueUsd);
    return {
      valid: false,
      reason: `REJECTED: Account-Aware Stop Bound exceeded on ${symbol}. Stop distance (${stopDistance.toFixed(3)}) risks $${minLotDollarRisk.toFixed(2)} at 0.01 lot, exceeding the 2.0% equity cap ($${maxDollarLoss.toFixed(2)} on $${portfolioCapital.toFixed(0)} capital). Maximum allowable stop distance is ${maxStopDist.toFixed(3)}.`
    };
  }

  return { valid: true };
}

// 2-Hour Symbol Generation Debounce & Anti-Burst Lockout
export async function validateSymbolGenerationDebounce(
  supabase: SupabaseClient,
  symbol: string,
  debounceHours: number = 2
): Promise<RiskValidationResult> {
  const windowAgo = new Date(Date.now() - debounceHours * 60 * 60 * 1000).toISOString();
  const { data: recentSignals, error } = await supabase
    .from("trade_opportunities")
    .select("id, symbol, side, created_at, status, source")
    .eq("symbol", symbol)
    .in("status", ["APPROVED", "PENDING_APPROVAL", "ACTIVE", "QUEUED"])
    .eq("is_archived", false)
    .gte("created_at", windowAgo)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.warn(`[Debounce Guard] Error querying recent signals for ${symbol}: ${error.message}`);
    return { valid: true };
  }

  if (recentSignals && recentSignals.length > 0) {
    const prev = recentSignals[0];
    return {
      valid: false,
      reason: `REJECTED: 2-Hour Symbol Debounce active for ${symbol}. Opportunity ${prev.id} (${prev.source || "agent"} ${prev.side}) was generated at ${prev.created_at} (${prev.status}). Anti-burst cooldown active.`
    };
  }

  return { valid: true };
}

// Sibling Consensus & Inter-Agent Conflict Shield (4-Hour Window)
export async function validateSiblingAgentConsensus(
  supabase: SupabaseClient,
  symbol: string,
  proposedSide: string,
  consensusWindowHours: number = 4
): Promise<RiskValidationResult> {
  if (!proposedSide || proposedSide === "NONE") return { valid: true };

  const normProposed = (proposedSide.toUpperCase().includes("LONG") || proposedSide.toUpperCase().includes("BUY")) ? "LONG" : "SHORT";
  const windowAgo = new Date(Date.now() - consensusWindowHours * 60 * 60 * 1000).toISOString();

  const { data: recentSignals, error } = await supabase
    .from("trade_opportunities")
    .select("id, symbol, side, status, source, created_at")
    .gte("created_at", windowAgo)
    .in("status", ["APPROVED", "PENDING_APPROVAL", "ACTIVE", "QUEUED", "WON"])
    .eq("is_archived", false);

  if (error || !recentSignals) {
    return { valid: true };
  }

  // 1. Exact Symbol Opposite Direction Shield
  const directOpposites = recentSignals.filter(
    (s: any) => s.symbol === symbol && s.side && (
      (normProposed === "LONG" && (s.side === "SHORT" || s.side === "SELL")) ||
      (normProposed === "SHORT" && (s.side === "LONG" || s.side === "BUY"))
    )
  );

  if (directOpposites.length > 0) {
    const opp = directOpposites[0];
    return {
      valid: false,
      reason: `REJECTED: Sibling Agent Conflict Shield on ${symbol}. Active opposing signal ${opp.id} (${opp.source || "sibling agent"} ${opp.side}) was generated within ${consensusWindowHours}h (${opp.created_at}). Opposing directional signals forbidden.`
    };
  }

  // 2. Correlated Group Opposite Direction Shield (Indices, Energy)
  const currentGroup = CORRELATION_GROUPS[symbol];
  if (currentGroup && (currentGroup.group === "EQUITY_INDICES" || currentGroup.group === "ENERGY")) {
    const currentDirectionScore = (normProposed === "LONG" ? 1 : -1) * currentGroup.weight;
    for (const s of recentSignals) {
      if (s.symbol !== symbol) {
        const peerGroup = CORRELATION_GROUPS[s.symbol];
        if (peerGroup && peerGroup.group === currentGroup.group) {
          const peerSideNorm = (s.side === "LONG" || s.side === "BUY") ? "LONG" : "SHORT";
          const peerDirectionScore = (peerSideNorm === "LONG" ? 1 : -1) * peerGroup.weight;
          if (currentDirectionScore * peerDirectionScore < 0) {
            return {
              valid: false,
              reason: `REJECTED: Sibling Agent Correlation Conflict Shield. Opposing ${currentGroup.group} setup active (${s.symbol} ${s.side} from ${s.source || "sibling agent"}). Proposing ${symbol} ${normProposed} contradicts open basket exposure.`
            };
          }
        }
      }
    }
  }

  return { valid: true };
}

// Validates if the central AI is allowed to generate a new signal for this asset
export async function validateGlobalSignal(
  supabase: SupabaseClient,
  symbol: string,
  currentSnapshot?: LogicContext,
  isManual: boolean = false,
  proposedSide?: string
): Promise<RiskValidationResult> {
  if (isManual) {
    console.log(`[Risk Manager] Manual bypass engaged for ${symbol}. Skipping correlation and isolation guards.`);
    return { valid: true };
  }

  // --- 2-HOUR SYMBOL GENERATION DEBOUNCE & ANTI-BURST LOCKOUT ---
  const debounceCheck = await validateSymbolGenerationDebounce(supabase, symbol, 2);
  if (!debounceCheck.valid) {
    return debounceCheck;
  }

  // Determine candidate side for consensus and correlation validation
  let assumedSide = proposedSide ? proposedSide.toUpperCase() : 'NONE';
  if (assumedSide === 'NONE' && currentSnapshot) {
    if (currentSnapshot.trend_alignment?.startsWith('BULLISH') || currentSnapshot.htf_trend === 'BULLISH') assumedSide = 'LONG';
    else if (currentSnapshot.trend_alignment?.startsWith('BEARISH') || currentSnapshot.htf_trend === 'BEARISH') assumedSide = 'SHORT';
  }

  // --- SIBLING CONSENSUS & INTER-AGENT CONFLICT SHIELD (4-Hour Window) ---
  if (assumedSide !== 'NONE') {
    const consensusCheck = await validateSiblingAgentConsensus(supabase, symbol, assumedSide, 4);
    if (!consensusCheck.valid) {
      return consensusCheck;
    }
  }

  // --- ACCOUNT-AWARE DYNAMIC MAXIMUM STOP BOUNDS (2.0% Equity Cap) ---
  if (currentSnapshot?.current_price) {
    const candidateSl = assumedSide === 'LONG'
      ? (currentSnapshot.safe_long_stop_loss || currentSnapshot.recent_swing_low)
      : (currentSnapshot.safe_short_stop_loss || currentSnapshot.recent_swing_high);
    if (candidateSl) {
      const stopBoundCheck = validateAccountStopBounds(symbol, currentSnapshot.current_price, candidateSl, 1020.0);
      if (!stopBoundCheck.valid) {
        return stopBoundCheck;
      }
    }
  }

  // Fetch active and pending signals
  const { data: activeSignals, error: activeError } = await supabase
    .from("trade_opportunities")
    .select("id, symbol, side, entry_plan_json, stop_plan_json")
    .in("status", ["APPROVED", "PENDING_APPROVAL"])
    .eq("is_archived", false);

  if (activeError) {
    return { valid: false, reason: "Risk Check Failed: Could not query active signals" };
  }

  // --- VELOCITY / FLASH-FILL LOCKOUT GUARD ---
  const { data: velocityLockout } = await supabase
    .from("market_context")
    .select("id, expires_at")
    .in("symbol", [symbol, "GLOBAL"])
    .eq("macro_bias", "VELOCITY_LOCKOUT")
    .gt("expires_at", new Date().toISOString())
    .limit(1);

  if (velocityLockout && velocityLockout.length > 0) {
    return {
      valid: false,
      reason: `REJECTED: Active VELOCITY_LOCKOUT circuit breaker engaged until ${velocityLockout[0].expires_at}. Rapid execution cascade detected.`
    };
  }

  // --- CONCURRENT PENDING ORDER CAP GUARD (Max 3 resting setups) ---
  const pendingCapCheck = await validateConcurrentPendingCap(supabase, 3);
  if (!pendingCapCheck.valid) {
    return pendingCapCheck;
  }

  // --- AGGREGATE COMMITTED PORTFOLIO HEAT GUARD (Max 8% total open+pending risk) ---
  const aggregateHeatCheck = await validateAggregateCommittedHeat(supabase, 0, 0.08);
  if (!aggregateHeatCheck.valid) {
    return aggregateHeatCheck;
  }

  // --- GUARD: Check for OPEN & PENDING trades in user_trades ---
  const { data: openTrades, error: openTradesError } = await supabase
    .from("user_trades")
    .select("id, symbol, side, status, open_price, created_at, meta_api_order_id, opportunity_id")
    .in("status", ["OPEN", "VPS_PENDING", "VPS_PROCESSING"]);
    
  if (openTradesError) {
    return { valid: false, reason: "Risk Check Failed: Could not query open trades" };
  }

  const liveTradesForSymbol = openTrades ? openTrades.filter((t: any) => t.symbol === symbol) : [];
  if (liveTradesForSymbol.length > 0) {
    // Check if the trade is truly a filled active position (status OPEN with broker ticket, or valid open_price)
    const hasFilledPosition = liveTradesForSymbol.some(
      (t: any) => (t.status === "OPEN" && t.meta_api_order_id) || (t.open_price !== null && t.open_price !== undefined)
    );
    
    // Check age of pending trades
    const now = Date.now();
    const hasFreshPendingOrder = liveTradesForSymbol.some((t: any) => {
      const createdAt = t.created_at ? new Date(t.created_at).getTime() : 0;
      const ageHours = (now - createdAt) / (1000 * 60 * 60);
      return ageHours < 2; // Under 2 hours is considered active pending
    });

    if (hasFilledPosition) {
      return { valid: false, reason: `REJECTED: Strict 1-trade-per-symbol isolation. A live filled position for ${symbol} is already OPEN.` };
    } else if (hasFreshPendingOrder) {
      return { valid: false, reason: `REJECTED: Strict 1-trade-per-symbol isolation. A fresh pending order for ${symbol} is awaiting fill (<2h old).` };
    } else {
      // Stale pending limit order (>2h unfilled). Auto-cancel/expire it and allow the new high-conviction signal!
      console.log(`[Risk Manager] Found stale unfilled pending order for ${symbol} (>2h old). Superseding with fresh signal.`);
      for (const staleTrade of liveTradesForSymbol) {
        // Strict guard: Never auto-close an active broker position
        if (staleTrade.status === "OPEN" && staleTrade.meta_api_order_id) {
          continue;
        }
        await supabase.from("user_trades").update({ 
          status: "CLOSED", 
          error_message: "Superseded by fresh AI signal" 
        }).eq("id", staleTrade.id);
        if (staleTrade.opportunity_id) {
          await supabase.from("trade_opportunities").update({ 
            status: "EXPIRED", 
            closed_at: new Date().toISOString() 
          }).eq("id", staleTrade.opportunity_id).in("status", ["ACTIVE", "APPROVED", "QUEUED"]);
        }
      }
    }
  }

  // --- CONSECUTIVE STOP-LOSS COOLDOWN (12-Hour Anti-Revenge & Cascade Guard) ---
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const { data: recentLosses } = await supabase
    .from("user_trades")
    .select("id, symbol, side, closed_at, status")
    .eq("symbol", symbol)
    .eq("status", "LOST")
    .gte("closed_at", twelveHoursAgo)
    .order("closed_at", { ascending: false })
    .limit(1);

  if (recentLosses && recentLosses.length > 0) {
    const lastLoss = recentLosses[0];
    return {
      valid: false,
      reason: `REJECTED: 12-Hour Stop-loss cooldown active for ${symbol}. Trade stopped out within the last 12 hours (${lastLoss.closed_at}). Cooling down to prevent knife-catching and serial losses.`,
    };
  }
  // --------------------------------------------------------

  // Guardrail: Asset Isolation (Don't spam multiple signals for the same asset)
  if (activeSignals) {
    const activeForSymbol = activeSignals.filter((t: any) => t.symbol === symbol);
    if (activeForSymbol.length > 0) {
      if (activeForSymbol.length >= 2) {
        return { valid: false, reason: `REJECTED: Maximum pyramiding capacity reached (2 trades active for ${symbol}).` };
      }

      if (currentSnapshot && currentSnapshot.current_price && currentSnapshot.atr_14) {
        const existingTrade = activeForSymbol[0];
        const entryPrice = existingTrade.entry_plan_json?.price;
        if (entryPrice) {
          const priceDiff = Math.abs(currentSnapshot.current_price - entryPrice);
          const atr = currentSnapshot.atr_14;
          // If the current price is at least 0.50 ATR away from the first entry, allow scaling in
          if (priceDiff > atr * 0.50) {
            console.log(`[Risk Manager] Pyramiding approved for ${symbol}. Current price is > 0.50 ATR from original entry.`);
          } else {
            return { valid: false, reason: `REJECTED: Asset isolation enforced. Active trade for ${symbol} is not far enough in profit (needs >0.50 ATR) to safely scale in.` };
          }
        }
      } else {
        return { valid: false, reason: `REJECTED: Asset isolation enforced. Signal already active for ${symbol}` };
      }
    }
  }

  // --- BASE/QUOTE CURRENCY EXPOSURE DECOMPOSITION & CONFLICT GUARD ---
  if (assumedSide === 'NONE' && currentSnapshot) {
    if (currentSnapshot.trend_alignment?.startsWith('BULLISH')) assumedSide = 'LONG';
    else if (currentSnapshot.trend_alignment?.startsWith('BEARISH')) assumedSide = 'SHORT';
  }

  const currencyExposures: Record<string, number> = {};
  const processedOppIds = new Set<string>();

  const addExposure = (sym: string, side: string) => {
    const decomp = CURRENCY_DECOMPOSITION[sym];
    if (!decomp) return;
    const isLong = side === 'LONG' || side === 'BUY';
    const baseDelta = isLong ? 1 : -1;
    const quoteDelta = isLong ? -1 : 1;

    currencyExposures[decomp.base] = (currencyExposures[decomp.base] || 0) + baseDelta;
    currencyExposures[decomp.quote] = (currencyExposures[decomp.quote] || 0) + quoteDelta;
  };

  // 1. Tally from live open trades
  if (openTrades) {
    for (const ut of openTrades) {
      if (ut.symbol !== symbol) {
        addExposure(ut.symbol, ut.side);
        if (ut.opportunity_id) processedOppIds.add(ut.opportunity_id);
      }
    }
  }

  // 2. Tally from unpicked approved signals (deduplicating if already in user_trades)
  if (activeSignals) {
    for (const sig of activeSignals) {
      if (sig.symbol !== symbol && !processedOppIds.has(sig.id)) {
        addExposure(sig.symbol, sig.side);
      }
    }
  }

  // Evaluate candidate symbol currency conflict
  const candidateDecomp = CURRENCY_DECOMPOSITION[symbol];
  if (candidateDecomp && assumedSide !== 'NONE') {
    const isCandLong = assumedSide === 'LONG';
    const candBaseDelta = isCandLong ? 1 : -1;
    const candQuoteDelta = isCandLong ? -1 : 1;

    const baseExp = currencyExposures[candidateDecomp.base] || 0;
    const quoteExp = currencyExposures[candidateDecomp.quote] || 0;

    // Check Base Currency Conflict (e.g. portfolio is Short EUR (-1), and candidate proposes Long EUR (+1))
    if (Math.abs(baseExp) >= 1 && Math.sign(baseExp) !== Math.sign(candBaseDelta)) {
      const dirText = baseExp > 0 ? "Bullish" : "Bearish";
      const candText = candBaseDelta > 0 ? "Bullish" : "Bearish";
      return {
        valid: false,
        reason: `REJECTED: Currency Exposure Conflict on ${candidateDecomp.base}. Portfolio is currently ${dirText} (Net: ${baseExp}). Proposed ${symbol} ${assumedSide} would create a conflicting ${candText} exposure.`
      };
    }

    // Check Quote Currency Conflict (e.g. portfolio is Bullish JPY (+1), and candidate proposes Bearish JPY (-1))
    if (Math.abs(quoteExp) >= 1 && Math.sign(quoteExp) !== Math.sign(candQuoteDelta)) {
      const dirText = quoteExp > 0 ? "Bullish" : "Bearish";
      const candText = candQuoteDelta > 0 ? "Bullish" : "Bearish";
      return {
        valid: false,
        reason: `REJECTED: Currency Exposure Conflict on ${candidateDecomp.quote}. Portfolio is currently ${dirText} (Net: ${quoteExp}). Proposed ${symbol} ${assumedSide} would create a conflicting ${candText} exposure.`
      };
    }
  }

  // Guardrail: Comprehensive Portfolio Correlation Basket Limits
  const symbolGroup = CORRELATION_GROUPS[symbol];
  if (symbolGroup && currentSnapshot) {
    let existingExposure = 0;
    
    // Check signals in trade_opportunities
    if (activeSignals) {
      for (const t of activeSignals) {
        if (t.symbol !== symbol && !processedOppIds.has(t.id)) {
          const activeGroup = CORRELATION_GROUPS[t.symbol];
          if (activeGroup && activeGroup.group === symbolGroup.group) {
            const activeWeight = (t.side === 'LONG' ? 1 : -1) * activeGroup.weight;
            existingExposure += activeWeight;
          }
        }
      }
    }

    // Check live open positions in user_trades
    if (openTrades) {
      for (const ut of openTrades) {
        if (ut.symbol !== symbol) {
          const activeGroup = CORRELATION_GROUPS[ut.symbol];
          if (activeGroup && activeGroup.group === symbolGroup.group) {
            const activeWeight = (ut.side === 'LONG' || ut.side === 'BUY' ? 1 : -1) * activeGroup.weight;
            existingExposure += activeWeight;
          }
        }
      }
    }

    if (assumedSide !== 'NONE') {
      const assumedWeight = (assumedSide === 'LONG' ? 1 : -1) * symbolGroup.weight;
      const projectedExposure = existingExposure + assumedWeight;

      // If the absolute net exposure exceeds 1 in indices/energy, reject to prevent stacked correlation
      if (Math.abs(projectedExposure) > 1) {
        return { valid: false, reason: `REJECTED: Portfolio correlation limit exceeded. Cannot stack multiple correlated ${symbolGroup.group} trades (Current Net Exposure: ${existingExposure}, Projected: ${projectedExposure}).` };
      }
    }
  }

  // --- ORDER FLOW & VOLUME SURGE GUARD ---
  if (currentSnapshot && currentSnapshot.volume_regime === 'ANEMIC' && currentSnapshot.volume_ratio && currentSnapshot.volume_ratio < 0.6) {
    console.warn(`[Risk Manager] Low Liquidity Warning: ${symbol} volume is ANEMIC (Ratio: ${currentSnapshot.volume_ratio}x).`);
  }

  return { valid: true };
}

// Validates whether a momentum breakout strategy has sufficient institutional volume backing
export function validateOrderFlowBreakout(
  strategyApplied: string,
  snapshot?: LogicContext
): RiskValidationResult {
  if (!snapshot) return { valid: true };

  const isBreakout = strategyApplied === 'MOMENTUM_BREAKOUT' || 
                     strategyApplied === 'MACRO_MOMENTUM_BREAKOUT' || 
                     strategyApplied === 'BREAKOUT';

  if (isBreakout) {
    const volRatio = snapshot.volume_ratio ?? 1.0;
    // Breakout requires at least normal volume (>= 0.85x) and preferably a surge
    if (snapshot.volume_regime === 'ANEMIC' || volRatio < 0.80) {
      return {
        valid: false,
        reason: `REJECTED (Order Flow Guard): Breakout rejected due to anemic volume (${volRatio.toFixed(2)}x < 0.80x baseline). False breakout trap detected.`
      };
    }
  }

  return { valid: true };
}

// Validates that the total number of concurrent resting pending orders does not exceed max limit
export async function validateConcurrentPendingCap(
  supabase: SupabaseClient,
  maxPending: number = 3
): Promise<RiskValidationResult> {
  // Check pending opportunities in trade_opportunities
  const { data: pendingOpps, error: oppError } = await supabase
    .from("trade_opportunities")
    .select("id")
    .in("status", ["APPROVED", "QUEUED"])
    .eq("is_archived", false);

  if (oppError) {
    return { valid: false, reason: "Risk Check Failed: Could not query pending opportunities count" };
  }

  const oppCount = pendingOpps?.length || 0;

  // If there are already >= maxPending resting pending opportunities, cap new order placement
  if (oppCount >= maxPending) {
    return {
      valid: false,
      reason: `REJECTED: Concurrent pending order limit reached (${oppCount} active/queued setups waiting, max allowed: ${maxPending}). Protects against simultaneous execution cascades.`
    };
  }

  return { valid: true };
}

// Validates that the aggregate committed risk (all active positions + resting pending orders) does not exceed the fund budget
export async function validateAggregateCommittedHeat(
  supabase: SupabaseClient,
  newRiskAmount: number = 0,
  maxGlobalHeatPct: number = 0.08
): Promise<RiskValidationResult> {
  // Fetch master account settings
  const { data: masterSettings, error: settingsError } = await supabase
    .from("user_risk_settings")
    .select("portfolio_capital, max_portfolio_heat_pct")
    .eq("is_master_account", true)
    .maybeSingle();

  if (settingsError || !masterSettings) {
    return { valid: true };
  }

  const capital = Number(masterSettings.portfolio_capital) || 10000;
  const heatPct = Number(masterSettings.max_portfolio_heat_pct) || maxGlobalHeatPct;
  const maxAllowedHeatUsd = capital * Math.min(heatPct, maxGlobalHeatPct);

  // Query all active and pending user trades
  const { data: activeTrades, error: tradesError } = await supabase
    .from("user_trades")
    .select("risk_amount, status")
    .in("status", ["OPEN", "PENDING", "VPS_PENDING", "VPS_PROCESSING"]);

  if (tradesError) {
    return { valid: false, reason: "Risk Check Failed: Could not query active trades for aggregate heat" };
  }

  let totalCommittedRisk = 0;
  if (activeTrades) {
    for (const t of activeTrades) {
      totalCommittedRisk += Number(t.risk_amount) || 0;
    }
  }

  const projectedHeat = totalCommittedRisk + newRiskAmount;
  if (projectedHeat > maxAllowedHeatUsd) {
    return {
      valid: false,
      reason: `REJECTED: Aggregate Committed Portfolio Heat Cap breached. Current committed risk is $${totalCommittedRisk.toFixed(2)} (${((totalCommittedRisk / capital) * 100).toFixed(1)}%). Adding $${newRiskAmount.toFixed(2)} would exceed max heat budget of $${maxAllowedHeatUsd.toFixed(2)} (${(heatPct * 100).toFixed(1)}%).`
    };
  }

  return { valid: true };
}

// Validates if a specific user can take a new trade based on their personal heat cap
export async function validateUserExposure(
  supabase: SupabaseClient,
  userId: string,
  newRiskAmount: number
): Promise<RiskValidationResult> {
  // Fetch user's active and pending trades to calculate current heat
  const { data: userTrades, error: tradesError } = await supabase
    .from("user_trades")
    .select("risk_amount, status")
    .eq("user_id", userId)
    .in("status", ["OPEN", "PENDING", "VPS_PENDING", "VPS_PROCESSING"]);

  if (tradesError) {
    return { valid: false, reason: "Failed to query user trades" };
  }

  // Fetch user's risk settings
  const { data: settings, error: settingsError } = await supabase
    .from("user_risk_settings")
    .select("portfolio_capital, max_portfolio_heat_pct")
    .eq("user_id", userId)
    .single();

  if (settingsError || !settings) {
    return { valid: false, reason: "User risk settings not found" };
  }

  let currentHeat = 0;
  if (userTrades) {
    currentHeat = userTrades.reduce((sum: number, trade: any) => sum + Number(trade.risk_amount || 0), 0);
  }

  const maxHeatPct = Math.min(Number(settings.max_portfolio_heat_pct) || 0.08, 0.08); // 8% hard ceiling
  const maxHeat = Number(settings.portfolio_capital) * maxHeatPct;

  if ((currentHeat + newRiskAmount) > maxHeat) {
    return { 
      valid: false, 
      reason: `REJECTED: User Portfolio Heat limit (${(maxHeatPct * 100).toFixed(1)}%) exceeded. Current: $${currentHeat.toFixed(2)}, Proposed: $${(currentHeat + newRiskAmount).toFixed(2)}, Max: $${maxHeat.toFixed(2)}` 
    };
  }

  return { valid: true };
}

// ============================================================================
// AI Risk Guardrail (formerly Devil's Advocate)
// ============================================================================

export interface AIRiskContext {
  symbol: string;
  side: "BUY" | "SELL" | "LONG" | "SHORT";
  price: number;
  setup_label: string;
  macro_bias: string;
  fib_narrative?: string;
  technical_reasons: string;
}

export interface AIRiskValidationResult {
  approved: boolean;
  reason: string;
}

/**
 * Validates a signal qualitatively using an LLM (Responses API) to check for 
 * fundamental or structural contradictions before execution.
 */
export async function validateSignalWithAI(
  supabase: SupabaseClient,
  context: AIRiskContext,
  traceId: string
): Promise<AIRiskValidationResult> {
  console.log(`[Risk Manager] [Trace: ${traceId}] AI Risk Check for ${context.side} on ${context.symbol}...`);
  
  // Try to use Deno.env (for Edge Functions) or process.env (for local tests)
  let openaiKey = "";
  try {
    openaiKey = Deno.env.get("OPENAI_API_KEY") || "";
  } catch {
    // @ts-ignore
    openaiKey = process?.env?.OPENAI_API_KEY || "";
  }

  if (!openaiKey) {
    console.warn(`[Risk Manager] [Trace: ${traceId}] No AI keys found. Bypassing AI check.`);
    return { approved: true, reason: "Bypassed: No AI configuration" };
  }

  const headers = {
    "Authorization": `Bearer ${openaiKey}`,
    "Content-Type": "application/json"
  };

  const userContent = `
PROPOSED TRADE:
Symbol: ${context.symbol}
Action: ${context.side}
Current Price: $${context.price}
Setup: ${context.setup_label}
Technical Basis: ${context.technical_reasons}

MARKET CONTEXT:
Macro Bias: ${context.macro_bias}
Fibonacci / Structure Narrative: ${context.fib_narrative || "None available"}

Analyze this trade and return your verdict.
  `;

  try {
    console.log(`[Responses API] [Risk Manager] Submitting ${context.symbol} AI analysis...`);
    
    const body = {
      model: "gpt-4o",
      input: userContent,
      tools: [
        {
          type: "function",
          name: "approve_trade",
          description: "Submit this action when the trade seems reasonable and doesn't contradict macro bias.",
          parameters: {
            type: "object",
            properties: {
              reason: { type: "string" }
            },
            required: ["reason"]
          }
        },
        {
          type: "function",
          name: "reject_trade",
          description: "Submit this action when the trade contradicts macro bias or is technically weak.",
          parameters: {
            type: "object",
            properties: {
              reason: { type: "string" }
            },
            required: ["reason"]
          }
        }
      ]
    };

    const responseRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    const responseData = await responseRes.json();
    
    if (responseData.error) {
      throw new Error(`Responses API Error: ${responseData.error.message}`);
    }

    const output = responseData.output;
    if (!output || output.length === 0) {
      throw new Error("No output returned from Responses API");
    }

    // Look for a function_call in the output array
    const toolCall = output.find((item: any) => item.type === "function_call");

    if (!toolCall) {
      throw new Error(`No tool call returned from AI. Full output: ${JSON.stringify(output)}`);
    }

    console.log(`[Responses API] [Risk Manager] Tool called: ${toolCall.name}`);
    const args = JSON.parse(toolCall.arguments);
    
    const result = {
      approved: toolCall.name === "approve_trade",
      reason: args.reason || "No reason provided."
    };
    
    // Log verdict to DB
    await supabase.from("agent_verdicts").insert({
      trace_id: traceId,
      agent_persona: "RISK_MANAGER_AI",
      symbol: context.symbol,
      action: context.side,
      verdict_approved: result.approved,
      verdict_reason: result.reason,
      context_json: context
    });

    console.log(`[Risk Manager] [Trace: ${traceId}] Verdict for ${context.symbol}: ${result.approved ? 'APPROVED' : 'REJECTED'} - ${result.reason}`);
    return result;
  } catch (error: any) {
    console.error(`[Risk Manager] [Trace: ${traceId}] Error during AI analysis:`, error.message);
    // Fail-open strategy to not block trades if AI fails
    return { approved: true, reason: `Bypassed: AI Error - ${error.message}` };
  }
}

// ============================================================
// CENTRAL BANK INTERVENTION & SOVEREIGN YIELD VETO
// Detects active or impending currency interventions by central banks
// (e.g. Bank of Japan JPY intervention, Swiss National Bank, Federal Reserve)
// and strictly rejects trades that oppose the sovereign intervention direction.
// ============================================================
export async function validateCentralBankIntervention(
  supabase: SupabaseClient,
  symbol: string,
  side: "LONG" | "SHORT" | string,
  headlines?: string[] | null
): Promise<RiskValidationResult> {
  try {
    const isLong = side === "LONG" || side === "BUY";
    const decomp = CURRENCY_DECOMPOSITION[symbol];

    // 1. Fetch recent macro context & scout headlines from system_settings
    const { data: settings } = await supabase
      .from("system_settings")
      .select("key, value")
      .in("key", ["macro_oracle_context", "macro_scout_processed_news"]);

    const textSources: string[] = [];
    if (headlines && headlines.length > 0) textSources.push(...headlines);

    if (settings) {
      for (const s of settings) {
        if (s.value) {
          if (typeof s.value === "string") textSources.push(s.value);
          else if (Array.isArray(s.value)) {
            s.value.forEach((item: any) => {
              if (typeof item === "string") textSources.push(item);
              else if (item?.title || item?.content || item?.forecast) textSources.push(JSON.stringify(item));
            });
          }
        }
      }
    }

    const combinedNews = textSources.join(" ").toLowerCase();

    // Specific Central Bank Intervention Patterns:
    // A. JPY Intervention (BOJ / Ministry of Finance defending Yen)
    const isJpyIntervention = 
      /bank of japan.*interven/i.test(combinedNews) ||
      /yen.*intervention/i.test(combinedNews) ||
      /boj.*rate hike/i.test(combinedNews) ||
      /kanda.*intervention/i.test(combinedNews) ||
      /mof.*currency intervention/i.test(combinedNews) ||
      /japan.*currency.*warn/i.test(combinedNews);

    if (isJpyIntervention && decomp) {
      // JPY is Bullish (Strengthening) during active intervention
      // If JPY is Quote (e.g. USDJPY, EURJPY, GBPJPY): LONG = Short JPY (Opposes intervention!), SHORT = Long JPY (Aligns)
      if (decomp.quote === "JPY" && isLong) {
        return {
          valid: false,
          reason: `REJECTED: Active Bank of Japan currency intervention regime detected. Going LONG on ${symbol} opposes sovereign Yen defense.`
        };
      }
      if (decomp.base === "JPY" && !isLong) {
        return {
          valid: false,
          reason: `REJECTED: Active Bank of Japan currency intervention regime detected. Going SHORT on ${symbol} opposes sovereign Yen defense.`
        };
      }
    }

    // B. CHF Intervention (SNB FX Intervention)
    const isChfIntervention = /snb.*interven/i.test(combinedNews) || /swiss national bank.*interven/i.test(combinedNews);
    if (isChfIntervention && decomp) {
      if (decomp.quote === "CHF" && isLong) {
        return {
          valid: false,
          reason: `REJECTED: Active SNB currency intervention regime detected. Proposed ${symbol} ${side} opposes sovereign CHF flows.`
        };
      }
    }

    // C. Gold / Metals vs Hawkish Fed Yield Surge
    const isHawkishFedSurge = 
      (/hawkish fed/i.test(combinedNews) || /higher for longer/i.test(combinedNews) || /yield surge/i.test(combinedNews) || /rate hike expected/i.test(combinedNews)) &&
      !(/dovish fed/i.test(combinedNews) || /rate cut/i.test(combinedNews));

    if (isHawkishFedSurge && (symbol.includes("XAU") || symbol.includes("XAG")) && isLong) {
      return {
        valid: false,
        reason: `REJECTED: Active Hawkish Fed & Treasury Yield Surge regime detected. Going LONG on precious metals (${symbol}) opposes macro sovereign rate flow.`
      };
    }

    return { valid: true };
  } catch (err: any) {
    console.warn(`[Risk Manager] Central Bank Intervention check error: ${err.message}`);
    return { valid: true }; // Non-blocking on unexpected error
  }
}

