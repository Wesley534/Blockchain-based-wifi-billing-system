export const getEthToKesRate = async () => {
    try {
      const response = await fetch("https://api.coinbase.com/v2/prices/ETH-KES/spot");
      if (!response.ok) {
        throw new Error("Failed to fetch exchange rate");
      }
      const data = await response.json();
      const rate = parseFloat(data.data.amount); // e.g., 247789.20
      return rate;
    } catch (err) {
      console.error("Exchange rate fetch error:", err);
      return 247789.20; // Fallback rate from Coinbase data[](https://www.coinbase.com/en-gb/converter/eth/kes)
    }
  };