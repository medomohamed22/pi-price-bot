exports.handler = async (event) => {
  // استقبال كلمة المرور من الطلب
  const { password } = JSON.parse(event.body);
  
  // جلب كلمة المرور المخزنة في Env
  const MASTER_PASS = process.env.ADMIN_PASSWORD;

  if (password === MASTER_PASS) {
    return {
      statusCode: 200,
      body: JSON.stringify({ authorized: true })
    };
  } else {
    return {
      statusCode: 401,
      body: JSON.stringify({ authorized: false, message: "Incorrect Password" })
    };
  }
};
