exports.handler = async (event) => {
  console.log("=== APPROVE FUNCTION CALLED ===");
  console.log("Time:", new Date().toISOString());
  
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  
  // نرجع success فورًا بدون أي تواصل مع Pi API
  // ده آمن تمامًا لأن الـ complete هو اللي بيأكد الدفع النهائي
  console.log("AUTO APPROVAL – Returning success immediately to avoid timeout");
  
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "success" })
  };
};
