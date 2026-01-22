exports.handler = async () => {
  const keys = ["ISSUER_SECRET", "DISTRIBUTOR_SECRET", "PI_API_KEY", "ADMIN_TOKEN"];
  const status = {};
  for (const k of keys) status[k] = process.env[k] ? "SET" : "MISSING";
  return { statusCode: 200, body: JSON.stringify({ status }, null, 2) };
};
