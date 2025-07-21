// api/bot.js - Vercel Serverless Function
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';

// 📊 In-memory cache (จะหายไปเมื่อ function ปิด)
let marketDataCache = {
  prices: [],
  indicators: {},
  patterns: [],
  lastUpdate: null,
  source: null
};

// 📈 Data Sources
const DATA_SOURCES = {
  YAHOO: 'https://query1.finance.yahoo.com/v8/finance/chart/GC=F',
  ALPHA_VANTAGE: `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=XAUUSD&interval=5min&apikey=${process.env.ALPHA_VANTAGE_KEY}`,
  TWELVE_DATA: `https://api.twelvedata.com/time_series?symbol=XAUUSD&interval=5min&apikey=${process.env.TWELVE_DATA_KEY}`
};

// 🧮 Technical Analysis Class
class TechnicalAnalysis {
  static calculateSMA(data, period) {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    return slice.reduce((sum, item) => sum + item.close, 0) / period;
  }
  
  static calculateEMA(data, period) {
    if (data.length < period) return null;
    
    const multiplier = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((sum, item) => sum + item.close, 0) / period;
    
    for (let i = period; i < data.length; i++) {
      ema = (data[i].close * multiplier) + (ema * (1 - multiplier));
    }
    return ema;
  }
  
  static calculateRSI(data, period = 14) {
    if (data.length < period + 1) return null;
    
    let gains = 0, losses = 0;
    
    for (let i = 1; i <= period; i++) {
      const change = data[data.length - i].close - data[data.length - i - 1].close;
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }
  
  static calculateBollingerBands(data, period = 20, multiplier = 2) {
    if (data.length < period) return null;
    
    const sma = this.calculateSMA(data, period);
    if (!sma) return null;
    
    const slice = data.slice(-period);
    const variance = slice.reduce((sum, item) => {
      return sum + Math.pow(item.close - sma, 2);
    }, 0) / period;
    
    const stdDev = Math.sqrt(variance);
    
    return {
      upper: sma + (stdDev * multiplier),
      middle: sma,
      lower: sma - (stdDev * multiplier),
      width: (stdDev * multiplier * 2) / sma * 100
    };
  }
}

// 📊 Pattern Recognition
class PatternRecognition {
  static detectPatterns(data) {
    if (data.length < 20) return [];
    
    const patterns = [];
    const recent = data.slice(-20);
    
    // Double Top/Bottom detection
    patterns.push(...this.detectDoubleTopBottom(recent));
    
    return patterns;
  }
  
  static detectDoubleTopBottom(data) {
    const patterns = [];
    const highs = [];
    const lows = [];
    
    // Find local highs and lows
    for (let i = 1; i < data.length - 1; i++) {
      if (data[i].high > data[i-1].high && data[i].high > data[i+1].high) {
        highs.push({ index: i, price: data[i].high });
      }
      if (data[i].low < data[i-1].low && data[i].low < data[i+1].low) {
        lows.push({ index: i, price: data[i].low });
      }
    }
    
    // Check for double tops
    if (highs.length >= 2) {
      const lastTwo = highs.slice(-2);
      const priceDiff = Math.abs(lastTwo[0].price - lastTwo[1].price);
      const avgPrice = (lastTwo[0].price + lastTwo[1].price) / 2;
      
      if (priceDiff / avgPrice < 0.01) {
        patterns.push({
          type: 'DOUBLE_TOP',
          confidence: 75,
          description: 'Potential reversal - Consider SELL',
          resistance: avgPrice
        });
      }
    }
    
    // Check for double bottoms
    if (lows.length >= 2) {
      const lastTwo = lows.slice(-2);
      const priceDiff = Math.abs(lastTwo[0].price - lastTwo[1].price);
      const avgPrice = (lastTwo[0].price + lastTwo[1].price) / 2;
      
      if (priceDiff / avgPrice < 0.01) {
        patterns.push({
          type: 'DOUBLE_BOTTOM',
          confidence: 75,
          description: 'Potential reversal - Consider BUY',
          support: avgPrice
        });
      }
    }
    
    return patterns;
  }
}

// 📊 Fetch Gold Data
async function fetchGoldData() {
  try {
    const response = await axios.get(DATA_SOURCES.YAHOO, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    const chart = response.data.chart.result[0];
    const timestamps = chart.timestamp;
    const prices = chart.indicators.quote[0];
    
    const formattedData = timestamps.map((timestamp, index) => ({
      time: new Date(timestamp * 1000),
      open: prices.open[index],
      high: prices.high[index],
      low: prices.low[index],
      close: prices.close[index],
      volume: chart.indicators.quote[0].volume[index] || 0
    })).filter(candle => candle.close !== null);
    
    marketDataCache.prices = formattedData.slice(-100);
    marketDataCache.lastUpdate = new Date();
    marketDataCache.source = 'Yahoo Finance';
    
    // Calculate indicators
    const data = marketDataCache.prices;
    if (data.length >= 20) {
      marketDataCache.indicators = {
        sma20: TechnicalAnalysis.calculateSMA(data, 20),
        sma50: TechnicalAnalysis.calculateSMA(data, 50),
        ema12: TechnicalAnalysis.calculateEMA(data, 12),
        rsi: TechnicalAnalysis.calculateRSI(data, 14),
        bollinger: TechnicalAnalysis.calculateBollingerBands(data)
      };
      
      marketDataCache.patterns = PatternRecognition.detectPatterns(data);
    }
    
    return true;
  } catch (error) {
    console.error('Failed to fetch data:', error.message);
    return false;
  }
}

// 🎯 Generate Trading Signal
function generateSignal() {
  if (!marketDataCache.indicators.rsi || marketDataCache.prices.length === 0) {
    return { signal: 'NO_DATA', confidence: 0 };
  }
  
  const { rsi, bollinger, sma20, sma50 } = marketDataCache.indicators;
  const currentPrice = marketDataCache.prices[marketDataCache.prices.length - 1].close;
  const patterns = marketDataCache.patterns;
  
  let signal = 'HOLD';
  let confidence = 0;
  let reasons = [];
  
  // RSI Analysis
  if (rsi < 25) {
    signal = 'STRONG_BUY';
    confidence += 40;
    reasons.push(`RSI oversold (${rsi.toFixed(1)})`);
  } else if (rsi < 35) {
    signal = 'BUY';
    confidence += 25;
    reasons.push(`RSI low (${rsi.toFixed(1)})`);
  } else if (rsi > 75) {
    signal = 'STRONG_SELL';
    confidence += 40;
    reasons.push(`RSI overbought (${rsi.toFixed(1)})`);
  } else if (rsi > 65) {
    signal = 'SELL';
    confidence += 25;
    reasons.push(`RSI high (${rsi.toFixed(1)})`);
  }
  
  // Moving Average Analysis
  if (sma20 && sma50) {
    if (currentPrice > sma20 && sma20 > sma50 && signal.includes('BUY')) {
      confidence += 15;
      reasons.push('Bullish MA trend');
    } else if (currentPrice < sma20 && sma20 < sma50 && signal.includes('SELL')) {
      confidence += 15;
      reasons.push('Bearish MA trend');
    }
  }
  
  // Bollinger Bands
  if (bollinger) {
    if (currentPrice < bollinger.lower && signal.includes('BUY')) {
      confidence += 15;
      reasons.push('Below lower Bollinger');
    } else if (currentPrice > bollinger.upper && signal.includes('SELL')) {
      confidence += 15;
      reasons.push('Above upper Bollinger');
    }
  }
  
  return {
    signal,
    confidence: Math.min(confidence, 95),
    reasons,
    price: currentPrice,
    indicators: marketDataCache.indicators,
    patterns: patterns.slice(0, 3)
  };
}

// 🤖 Main Handler Function
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method === 'GET') {
    // Health check endpoint
    return res.json({
      status: '🟢 Gold Bot - Vercel Serverless',
      dataPoints: marketDataCache.prices.length,
      lastUpdate: marketDataCache.lastUpdate,
      source: marketDataCache.source
    });
  }
  
  if (req.method === 'POST') {
    try {
      const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
      const { body } = req;
      
      if (body.message) {
        const chatId = body.message.chat.id;
        const text = body.message.text;
        
        // Handle commands
        if (text === '/start') {
          await bot.sendMessage(chatId, 
            `🤖 Gold Analysis Bot (Vercel)\n\n` +
            `📊 Real-time gold price analysis\n` +
            `🔍 Technical indicators\n` +
            `📈 Chart patterns\n\n` +
            `Commands:\n` +
            `/price - Current price\n` +
            `/analysis - Full analysis\n` +
            `/signal - Trading signal`
          );
        }
        
        else if (text === '/price') {
          await fetchGoldData();
          
          if (marketDataCache.prices.length === 0) {
            await bot.sendMessage(chatId, '⚠️ Unable to fetch data. Please try again later.');
            return res.json({ ok: true });
          }
          
          const currentPrice = marketDataCache.prices[marketDataCache.prices.length - 1].close;
          const { rsi, sma20, bollinger } = marketDataCache.indicators;
          
          let message = `💰 XAU/USD: $${currentPrice?.toFixed(2)}\n`;
          message += `📅 ${new Date().toLocaleString('en-US')}\n\n`;
          
          if (rsi) message += `📊 RSI: ${rsi.toFixed(1)}\n`;
          if (sma20) message += `📈 SMA20: $${sma20.toFixed(2)}\n`;
          if (bollinger) {
            message += `🔺 BB Upper: $${bollinger.upper.toFixed(2)}\n`;
            message += `🔻 BB Lower: $${bollinger.lower.toFixed(2)}\n`;
          }
          
          await bot.sendMessage(chatId, message);
        }
        
        else if (text === '/analysis') {
          await fetchGoldData();
          const analysis = generateSignal();
          
          if (analysis.signal === 'NO_DATA') {
            await bot.sendMessage(chatId, '⚠️ Insufficient data for analysis.');
            return res.json({ ok: true });
          }
          
          let message = `📊 TECHNICAL ANALYSIS\n\n`;
          message += `💰 Price: $${analysis.price?.toFixed(2)}\n`;
          message += `🎯 Signal: ${analysis.signal} (${analysis.confidence}%)\n\n`;
          
          if (analysis.indicators.rsi) {
            message += `📈 INDICATORS:\n`;
            message += `• RSI: ${analysis.indicators.rsi.toFixed(1)}\n`;
            if (analysis.indicators.sma20) message += `• SMA20: $${analysis.indicators.sma20.toFixed(2)}\n`;
            if (analysis.indicators.bollinger) {
              message += `• BB Range: $${analysis.indicators.bollinger.lower.toFixed(2)} - $${analysis.indicators.bollinger.upper.toFixed(2)}\n`;
            }
            message += `\n`;
          }
          
          if (analysis.reasons.length > 0) {
            message += `📝 Analysis:\n• ${analysis.reasons.join('\n• ')}\n\n`;
          }
          
          if (analysis.patterns.length > 0) {
            message += `🔍 Patterns:\n`;
            analysis.patterns.forEach(pattern => {
              message += `• ${pattern.type} (${pattern.confidence}%)\n`;
            });
          }
          
          message += `\n⚠️ *For reference only - Not financial advice*`;
          
          await bot.sendMessage(chatId, message);
        }
        
        else if (text === '/signal') {
          await fetchGoldData();
          const analysis = generateSignal();
          
          if (analysis.signal === 'NO_DATA') {
            await bot.sendMessage(chatId, '⚠️ No data available for signal generation.');
            return res.json({ ok: true });
          }
          
          let emoji = '';
          switch(analysis.signal) {
            case 'STRONG_BUY': emoji = '🟢💪'; break;
            case 'BUY': emoji = '🟢'; break;
            case 'STRONG_SELL': emoji = '🔴💪'; break;
            case 'SELL': emoji = '🔴'; break;
            default: emoji = '🟡';
          }
          
          const message = `${emoji} TRADING SIGNAL\n\n` +
            `💰 Price: $${analysis.price?.toFixed(2)}\n` +
            `🎯 Signal: ${analysis.signal}\n` +
            `💪 Confidence: ${analysis.confidence}%\n` +
            `📊 RSI: ${analysis.indicators.rsi?.toFixed(1)}\n\n` +
            `📝 Based on: ${analysis.reasons.join(', ')}\n\n` +
            `⚠️ *Use proper risk management*`;
          
          await bot.sendMessage(chatId, message);
        }
        
        else {
          await bot.sendMessage(chatId, 
            `ℹ️ Available commands:\n` +
            `/price - Current gold price\n` +
            `/analysis - Full technical analysis\n` +
            `/signal - Trading signal`
          );
        }
      }
      
      return res.json({ ok: true });
      
    } catch (error) {
      console.error('Bot error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
}