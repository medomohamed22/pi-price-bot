// netlify/functions/update-escrow.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
    // التأكد من أن الطلب من نوع POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const { orderId, newStatus, uid } = JSON.parse(event.body);

    if (!orderId || !newStatus || !uid) {
        return { statusCode: 400, body: JSON.stringify({ error: 'بيانات مفقودة' }) };
    }

    // 🚨 استخدام المفتاح السري للسيرفر (يتخطى كل قيود المتصفح)
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY // تأكد من وجوده في إعدادات Netlify
    );

    try {
        // 1. جلب بيانات الصفقة للتأكد من هوية المستخدم
        const { data: order, error: fetchErr } = await supabase
            .from('escrow_transactions')
            .select('*')
            .eq('id', orderId)
            .single();

        if (fetchErr || !order) throw new Error('لم يتم العثور على الصفقة');

        // 2. التحقق الأمني (Security Checks)
        if (newStatus === 'SHIPPED') {
            // البائع فقط هو من يحق له الشحن
            if (order.seller_pi_id !== uid) throw new Error('غير مصرح لك: أنت لست البائع');
        } 
        else if (newStatus === 'COMPLETED' || newStatus === 'CANCELLED') {
            // المشتري فقط هو من يحق له التأكيد أو الإلغاء
            if (order.buyer_pi_id !== uid) throw new Error('غير مصرح لك: أنت لست المشتري');
            
            // لا يمكن الإلغاء إذا تم الشحن
            if (newStatus === 'CANCELLED' && order.status !== 'FUNDED' && order.status !== 'PENDING') {
                throw new Error('لا يمكن إلغاء الصفقة في هذه المرحلة');
            }
        }

        // 3. تحديث الحالة بأمان تام
        const { error: updateErr } = await supabase
            .from('escrow_transactions')
            .update({ status: newStatus })
            .eq('id', orderId);

        if (updateErr) throw updateErr;

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: 'تم تحديث الحالة بنجاح' })
        };

    } catch (error) {
        return {
            statusCode: 400,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
};
