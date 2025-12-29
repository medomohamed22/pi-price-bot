import type { HandlerEvent } from '@netlify/functions';

exports.handler = async (event: HandlerEvent) => {
  console.log("=== APPROVE FUNCTION CALLED ===");
  console.log("Time:", new Date().toISOString());
  
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  
  console.log("AUTO APPROVAL – Returning success immediately");
  
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "success" })
  };
};