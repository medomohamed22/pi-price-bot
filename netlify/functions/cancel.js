// netlify/functions/cancel.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
    // التأكد من أن الطلب من نوع POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const { orderId, uid } = JSON.parse(event.body);

    // استخدام المفتاح السري للسيرفر (الذي يتخطى قواعد الحماية لعمل التحديثات الحساسة)
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY // يجب أن يكون هذا المفتاح في إعدادات Netlify
    );

    try {
        // 1. جلب بيانات الصفقة
        const { data: order, error: fetchErr } = await supabase
            .from('escrow_transactions')
            .select('*')
            .eq('id', orderId)
            .single();

        if (fetchErr || !order) throw new Error('لم يتم العثور على الصفقة');

        // 2. التحقق من الأمان (Security Checks)
        // التأكد أن الذي طلب الإلغاء هو المشتري نفسه
        if (order.buyer_pi_id !== uid) throw new Error('غير مصرح لك بإلغاء هذه الصفقة');
        
        // التأكد أن الصفقة في حالة التجميد فقط (لا يمكن إلغاء صفقة تم شحنها)
        if (order.status !== 'FUNDED') throw new Error('لا يمكن إلغاء الصفقة في هذه المرحلة');

        // 3. تحديث الحالة إلى ملغية
        const { error: updateErr } = await supabase
            .from('escrow_transactions')
            .update({ status: 'CANCELLED' })
            .eq('id', orderId);

        if (updateErr) throw updateErr;

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: 'تم إلغاء الصفقة بنجاح' })
        };

    } catch (error) {
        return {
            statusCode: 400,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
};
