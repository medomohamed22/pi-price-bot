exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify({
      SB_URL: process.env.PUBLIC_SUPABASE_URL,
      SB_ANON: process.env.PUBLIC_SUPABASE_ANON_KEY
    })
  };
};


