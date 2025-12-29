// main.ts

declare global {
  interface Window {
    Pi: any;
  }
}

let currentUsername: string | null = null;

async function authenticate() {
  try {
    const scopes = ['username', 'payments'];
    const authResult = await window.Pi.authenticate(scopes);
    currentUsername = authResult.user.username;
    const welcomeElement = document.getElementById('welcome');
    if (welcomeElement) {
      welcomeElement.innerText = `مرحباً، ${currentUsername} 👋`;
    }
  } catch (err) {
    console.error(err);
    const welcomeElement = document.getElementById('welcome');
    if (welcomeElement) {
      welcomeElement.innerText = "افتح الموقع داخل Pi Browser";
    }
  }
}

async function payWithPi() {
  const input = document.getElementById('amount') as HTMLInputElement;
  const amountStr = input.value.replace(',', '.');
  const amount = parseFloat(amountStr);
  
  if (isNaN(amount) || amount <= 0) {
    alert("أدخل مبلغ صحيح أكبر من صفر (مثل 0.001 أو 1 أو 50)");
    return;
  }
  
  const paymentData = {
    amount: amount,
    memo: `دفع بـ ${amount} Pi - شكراً على الدفع ❤️`,
    metadata: { type: "simple_payment", amount: amount }
  };
  
  const callbacks = {
    onReadyForServerApproval: async (paymentId: string) => {
      try {
        const res = await fetch('/.netlify/functions/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentId })
        });
        const data = await res.json();
        console.log("Approval:", data);
      } catch (err) {
        console.error("Approval Error:", err);
      }
    },
    onReadyForServerCompletion: async (paymentId: string, txid: string) => {
      try {
        const res = await fetch('/.netlify/functions/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentId, txid })
        });
        const data = await res.json();
        console.log("Completion:", data);
      } catch (err) {
        console.error("Completion Error:", err);
      }
    },
    onCancel: () => console.log("Payment cancelled"),
    onError: (error: any) => console.error("Pi Error:", error)
  };
  
  window.Pi.createPayment(paymentData, callbacks);
}

document.addEventListener('DOMContentLoaded', () => {
  authenticate();
  
  const payButton = document.getElementById('payButton');
  if (payButton) {
    payButton.addEventListener('click', payWithPi);
  }
});