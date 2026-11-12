(() => {
console.info("Admin panel script loaded: 2026-10-28-1906");
const categoryNames = {
    chains: "سلاسل وكوليهات",
    bracelets: "أساور وانسيالات",
    rings: "خواتم",
    earrings: "حلقان",
    anklets: "خلخال",
    bangles: "غوايش",
    sets: "أطقم إكسسوارات",
    misc: "متنوعات"
};

const orderStatuses = { new: "جديد", reviewed: "قيد المراجعة", confirmed: "مؤكد", cancelled: "ملغي" };
const supabase = window.fedaaSupabase;
const config = window.FEDAA_SUPABASE_CONFIG;
const elements = {
    loginView: document.querySelector("#login-view"),
    dashboardView: document.querySelector("#dashboard-view"),
    setupWarning: document.querySelector("#setup-warning"),
    loginForm: document.querySelector("#login-form"),
    loginEmail: document.querySelector("#login-email"),
    loginPassword: document.querySelector("#login-password"),
    loginButton: document.querySelector("#login-button"),
    loginError: document.querySelector("#login-error"),
    ownerEmail: document.querySelector("#owner-email"),
    dashboardMessage: document.querySelector("#dashboard-message"),
    productForm: document.querySelector("#product-form"),
    productFormTitle: document.querySelector("#product-form-title"),
    productId: document.querySelector("#product-id"),
    productName: document.querySelector("#product-name"),
    productCategory: document.querySelector("#product-category"),
    productPrice: document.querySelector("#product-price"),
    productDescription: document.querySelector("#product-description"),
    productImageUrl: document.querySelector("#product-image-url"),
    addProductImageUrl: document.querySelector("#add-product-image-url"),
    productImageFile: document.querySelector("#product-image-file"),
    productImageList: document.querySelector("#product-image-list"),
    productUploadStatus: document.querySelector("#product-upload-status"),
    cancelEdit: document.querySelector("#cancel-edit"),
    productError: document.querySelector("#product-error"),
    productList: document.querySelector("#product-admin-list"),
    productsCount: document.querySelector("#product-count"),
    ordersList: document.querySelector("#orders-list"),
    ordersCount: document.querySelector("#order-count"),
    receiptDialog: document.querySelector("#receipt-dialog"),
    receiptDialogImage: document.querySelector("#receipt-dialog-image"),
    receiptDialogError: document.querySelector("#receipt-dialog-error"),
    heroForm: document.querySelector("#hero-form"),
    heroImageUrl: document.querySelector("#hero-image-url"),
    heroImageFile: document.querySelector("#hero-image-file"),
    heroImagePreview: document.querySelector("#hero-image-preview"),
    heroError: document.querySelector("#hero-error")
};

let products = [];
let currentUserId = "";
let productImageItems = [];
let productSaveInProgress = false;
let productImagePreparationInProgress = false;
let heroPreviewObjectUrl = "";
let heroPreparedFile = null;
let heroPreparationPromise = Promise.resolve();
let heroSaveInProgress = false;
const defaultHeroImage = "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=1100&q=85";
const MAX_COMPRESSED_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const HEIC_DECODER_URL = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";
let heicDecoderPromise = null;

function showMessage(element, message, visible = true) {
    element.textContent = message;
    element.hidden = !visible;
}

function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function throwOnError(error) {
    if (error) throw new Error(error.message || "تعذر تنفيذ الطلب.");
}

function setOwnerView(email) {
    const authenticated = Boolean(email);
    elements.loginView.hidden = authenticated;
    elements.dashboardView.hidden = !authenticated;
    if (authenticated) elements.ownerEmail.textContent = email;
}

function money(value) {
    if (value === null || value === undefined || value === "") return "غير متاح";
    const amount = Number(value);
    return Number.isFinite(amount)
        ? `${new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(amount)} ج.م`
        : "غير متاح";
}

function finiteAmount(...values) {
    for (const value of values) {
        if (value === null || value === undefined || value === "") continue;
        const amount = Number(value);
        if (Number.isFinite(amount)) return amount;
    }
    return null;
}

function orderItems(value) {
    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        } catch {
            return [];
        }
    }
    return Array.isArray(value) ? value : [];
}

function orderTotal(order, items) {
    const savedTotal = finiteAmount(order.total_amount, order.total, order.order_total, order.amount);
    if (savedTotal !== null && savedTotal > 0) return savedTotal;

    const itemTotals = items.map((item) => {
        const quantity = finiteAmount(item.quantity) ?? 0;
        const lineTotal = finiteAmount(item.lineTotal, item.line_total, item.total);
        if (lineTotal !== null && lineTotal > 0) return lineTotal;
        const unitPrice = finiteAmount(item.unitPrice, item.unit_price, item.price);
        if (unitPrice !== null && unitPrice > 0 && quantity > 0) return unitPrice * quantity;
        const productId = item.productId ?? item.product_id ?? item.id;
        const product = products.find((entry) => String(entry.id) === String(productId))
            || products.find((entry) => entry.name === (item.name || item.product_name));
        return product && product.price > 0 && quantity > 0 ? product.price * quantity : null;
    });
    const calculatedTotal = itemTotals.length > 0 && itemTotals.every((amount) => amount !== null)
        ? itemTotals.reduce((sum, amount) => sum + amount, 0)
        : null;
    if (calculatedTotal !== null && calculatedTotal > 0) return calculatedTotal;
    return savedTotal !== null && savedTotal > 0 ? savedTotal : null;
}

async function orderReceiptUrl(order, signed = false) {
    const storedPath = typeof order.receipt_path === "string" ? order.receipt_path.trim() : "";
    const legacyReceiptUrl = typeof order.receipt_url === "string" ? order.receipt_url.trim() : "";
    const receiptValue = storedPath || legacyReceiptUrl;
    if (!receiptValue) return "";

    if (/^https?:\/\//i.test(receiptValue)) {
        const receiptUrl = safeImageUrl(receiptValue);
        if (!receiptUrl) throw new Error("رابط إيصال التحويل المسجل غير صالح.");
        return receiptUrl;
    }

    const receiptPath = receiptValue.replace(/^\/+/, "");
    const receiptStorage = supabase.storage.from("order-receipts");
    if (!signed) {
        const { data } = receiptStorage.getPublicUrl(receiptPath);
        const publicUrl = safeImageUrl(data?.publicUrl);
        if (publicUrl) return publicUrl;
    }

    const { data, error } = await receiptStorage.createSignedUrl(receiptPath, 3600);
    throwOnError(error);
    if (!data?.signedUrl) throw new Error("لم يُرجع مخزن Supabase رابطاً صالحاً لصورة الإيصال.");
    return data.signedUrl;
}

function safeImageUrl(value) {
    try {
        const url = new URL(value, window.location.href);
        return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch {
        return "";
    }
}

function makeButton(text, className, onClick) {
    const button = makeElement("button", className, text);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
}

function productFromRow(row) {
    const images = Array.isArray(row.images) && row.images.length > 0 ? row.images : [row.image];
    return {
        id: row.id,
        name: row.name,
        category: row.category,
        categoryName: row.category_name,
        price: Number(row.price),
        oldPrice: row.old_price == null ? undefined : Number(row.old_price),
        description: row.description,
        image: row.image,
        images,
        alt: row.alt,
        badge: row.badge
    };
}

function renderProducts() {
    elements.productsCount.textContent = `${new Intl.NumberFormat("ar-EG").format(products.length)} منتج`;
    elements.productList.replaceChildren();
    if (products.length === 0) {
        elements.productList.append(makeElement("p", "empty-admin-state", "لا توجد منتجات بعد."));
        return;
    }

    products.forEach((product) => {
        const row = makeElement("article", "admin-product-row");
        const image = makeElement("img");
        image.src = safeImageUrl(product.images[0] || product.image);
        image.alt = "";
        image.loading = "lazy";
        const info = makeElement("div", "admin-product-info");
        info.append(makeElement("strong", "", product.name || "منتج بدون اسم"));
        info.append(makeElement("span", "", `${categoryNames[product.category] || "متنوعات"} · ${money(product.price)}`));
        const actions = makeElement("div", "row-actions");
        actions.append(makeButton("تعديل", "", () => editProduct(product)));
        actions.append(makeButton("حذف", "delete-product", () => deleteProduct(product)));
        row.append(image, info, actions);
        elements.productList.append(row);
    });
}

function editProduct(product) {
    elements.productId.value = product.id;
    elements.productName.value = product.name || "";
    elements.productCategory.value = product.category || "misc";
    elements.productPrice.value = product.price ?? "";
    elements.productDescription.value = product.description || "";
    elements.productImageUrl.value = "";
    elements.productImageFile.value = "";
    clearProductImageItems();
    productImageItems = (product.images?.length ? product.images : [product.image])
        .filter(Boolean)
        .map((url) => ({ url, file: null, objectUrl: "" }));
    renderProductImageItems();
    elements.productFormTitle.textContent = "تعديل المنتج";
    document.querySelector("#cancel-edit").hidden = false;
    elements.productForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetProductForm() {
    elements.productForm.reset();
    elements.productId.value = "";
    clearProductImageItems();
    renderProductImageItems();
    elements.productFormTitle.textContent = "إضافة منتج";
    elements.productUploadStatus.hidden = true;
    document.querySelector("#cancel-edit").hidden = true;
    showMessage(elements.productError, "", false);
}

function clearProductImageItems() {
    productImageItems.forEach((item) => {
        if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    });
    productImageItems = [];
}

function renderProductImageItems() {
    elements.productImageList.replaceChildren();
    productImageItems.forEach((item, index) => {
        const row = makeElement("div", "queued-image");
        const preview = makeElement("img");
        const previewUrl = item.objectUrl ? item.url : safeImageUrl(item.url);
        if (previewUrl) preview.src = previewUrl;
        preview.alt = `صورة المنتج ${index + 1}`;
        preview.loading = "lazy";
        preview.decoding = "async";
        const label = makeElement("span", "queued-image-label", item.error
            ? `تعذر تجهيز الصورة ${index + 1}`
            : item.preparing ? `جارٍ تجهيز الصورة ${index + 1}`
            : index === 0 ? `الصورة الرئيسية ${index + 1}` : `الصورة ${index + 1}`);
        const actions = makeElement("div", "queued-image-actions");
        const up = makeButton("↑", "image-order-button", () => moveProductImage(index, -1));
        up.disabled = index === 0;
        up.setAttribute("aria-label", "تحريك الصورة للأمام");
        const down = makeButton("↓", "image-order-button", () => moveProductImage(index, 1));
        down.disabled = index === productImageItems.length - 1;
        down.setAttribute("aria-label", "تحريك الصورة للخلف");
        const remove = makeButton("حذف", "image-remove-button", () => {
            const [removed] = productImageItems.splice(index, 1);
            if (removed.objectUrl) URL.revokeObjectURL(removed.objectUrl);
            renderProductImageItems();
        });
        actions.append(up, down, remove);
        row.append(preview, label, actions);
        elements.productImageList.append(row);
    });
}

function moveProductImage(index, offset) {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= productImageItems.length) return;
    [productImageItems[index], productImageItems[nextIndex]] = [productImageItems[nextIndex], productImageItems[index]];
    renderProductImageItems();
}

async function loadProducts() {
    const { data, error } = await supabase.from("products").select("*").order("created_at");
    throwOnError(error);
    products = (data || []).map(productFromRow);
    renderProducts();
}

async function loadHeroSettings() {
    const { data, error } = await supabase.from("store_settings").select("value").eq("key", "hero_image").maybeSingle();
    throwOnError(error);
    const currentImage = data?.value || defaultHeroImage;
    elements.heroImagePreview.src = safeImageUrl(currentImage) || defaultHeroImage;
    elements.heroImageUrl.value = data?.value || "";
}

async function loadOrders() {
    const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(200);
    throwOnError(error);
    await renderOrders(data || []);
}

async function loadDashboard(user) {
    if (user.id !== config.adminUserId) {
        currentUserId = "";
        await supabase.auth.signOut();
        setOwnerView("");
        showMessage(elements.setupWarning, "هذا الحساب غير مصرح له بإدارة المتجر. استخدمي حساب المالك المسجل في إعداد Supabase.");
        return;
    }
    currentUserId = user.id;
    setOwnerView(user.email);
    showMessage(elements.dashboardMessage, "جارٍ تحميل بيانات المتجر…");
    try {
        await loadProducts();
        await Promise.all([loadOrders(), loadHeroSettings()]);
        showMessage(elements.dashboardMessage, "تم تحميل المنتجات والطلبات.");
    } catch (error) {
        const missingTable = error.message?.includes("Could not find the table");
        showMessage(elements.dashboardMessage, missingTable
            ? "جداول Supabase غير مهيأة أو ينقصها تحديث الصور والإعدادات. شغّلي ملف supabase-setup.sql من SQL Editor."
            : error.message || "تعذر تحميل البيانات. راجعي إعدادات Supabase وسياسات RLS.");
    }
}

async function deleteProduct(product) {
    if (!window.confirm(`حذف المنتج «${product.name}» من المتجر؟`)) return;
    try {
        const { error } = await supabase.from("products").delete().eq("id", product.id);
        throwOnError(error);
        await loadProducts();
        showMessage(elements.dashboardMessage, "تم حذف المنتج من المتجر.");
    } catch (error) {
        showMessage(elements.dashboardMessage, error.message || "تعذر حذف المنتج.");
    }
}

function renderOrders(orders) {
    elements.ordersCount.textContent = new Intl.NumberFormat("ar-EG").format(orders.length);
    elements.ordersList.replaceChildren();
    if (orders.length === 0) {
        elements.ordersList.append(makeElement("p", "empty-admin-state", "لا توجد طلبات واردة حتى الآن."));
        return;
    }

    orders.forEach((order) => {
        const card = makeElement("article", "order-card");
        const details = makeElement("div");
        details.append(makeElement("h3", "", order.customer_name || "طلب جديد"));
        details.append(makeElement("p", "order-meta", `رقم الطلب: ${order.id} · ${new Date(order.created_at).toLocaleString("ar-EG")}`));
        details.append(makeElement("p", "order-meta", `الهاتف: ${order.customer_phone || order.phone || "—"}`));
        details.append(makeElement("p", "order-address", `العنوان: ${order.customer_address || [order.governorate, order.city, order.address].filter(Boolean).join("، ") || "—"}`));
        details.append(makeElement("p", "order-meta", `طريقة الشحن: ${order.shipping_method || "توصيل للعنوان"}`));
        const itemList = makeElement("ul", "order-items-list");
        const items = orderItems(order.items);
        if (items.length > 0) {
            items.forEach((item) => {
                const quantity = Number(item.quantity) || 0;
                const productId = item.productId ?? item.product_id ?? item.id;
                const product = products.find((entry) => String(entry.id) === String(productId))
                    || products.find((entry) => entry.name === (item.name || item.product_name));
                const imageUrl = safeImageUrl(
                    item.image || item.image_url || item.imageUrl || item.product_image
                    || (Array.isArray(item.images) ? item.images[0] : "")
                    || product?.images?.[0] || product?.image
                );
                const itemRow = makeElement("li", "order-item");
                if (imageUrl) {
                    const image = makeElement("img", "order-item-image");
                    image.src = imageUrl;
                    image.alt = item.name || item.product_name || "صورة المنتج";
                    image.loading = "lazy";
                    itemRow.append(image);
                }
                const itemInfo = makeElement("div", "order-item-info");
                const lineTotalValue = item.lineTotal ?? item.line_total;
                const unitPriceValue = item.unitPrice ?? item.unit_price;
                const lineTotal = lineTotalValue == null ? NaN : Number(lineTotalValue);
                const unitPrice = unitPriceValue == null
                    ? (Number.isFinite(lineTotal) && quantity > 0 ? lineTotal / quantity : Number(product?.price))
                    : Number(unitPriceValue);
                const amount = Number.isFinite(lineTotal) ? lineTotal : unitPrice * quantity;
                itemInfo.append(makeElement("strong", "", item.name || item.product_name || "منتج"));
                itemInfo.append(makeElement("span", "", `الكمية: ${quantity || "—"} · سعر القطعة: ${Number.isFinite(unitPrice) ? money(unitPrice) : "غير متاح"}`));
                itemInfo.append(makeElement("span", "", `إجمالي المنتج: ${Number.isFinite(amount) ? money(amount) : "غير متاح"}`));
                itemRow.append(itemInfo);
                itemList.append(itemRow);
            });
        } else {
            itemList.append(makeElement("li", "order-item-unavailable", "تفاصيل المنتجات غير متاحة"));
        }
        details.append(itemList);
        details.append(makeElement("p", "order-meta", `طريقة الدفع: ${order.payment_method || "—"}`));
        const amounts = makeElement("div", "order-amounts");
        const validTotal = orderTotal(order, items);
        const paymentOption = order.payment_option;
        const isFullPayment = paymentOption === "full";
        const isDepositPayment = paymentOption === "deposit";
        const savedDeposit = finiteAmount(order.paid_amount, order.deposit);
        const depositAmount = validTotal === null || validTotal <= 0
            ? null
            : savedDeposit === null
                ? isFullPayment
                    ? validTotal
                    : isDepositPayment
                        ? Math.round((validTotal / 2 + Number.EPSILON) * 100) / 100
                        : null
                : savedDeposit;
        const savedRemaining = finiteAmount(order.remaining_amount, order.remaining);
        const remainingAmount = validTotal === null || validTotal <= 0 || depositAmount === null
            ? null
            : savedRemaining === null
                ? isFullPayment
                    ? 0
                    : isDepositPayment
                        ? Math.round((validTotal - depositAmount + Number.EPSILON) * 100) / 100
                        : null
                : savedRemaining;
        const deliveryFee = finiteAmount(order.delivery_fee);
        const cashDue = remainingAmount === null || deliveryFee === null
            ? null
            : remainingAmount + deliveryFee;
        amounts.append(makeElement(
            "strong",
            "order-grand-total",
            `إجمالي الطلب (بدون التوصيل): ${money(validTotal)}`
        ));
        const paymentBadge = makeElement(
            "strong",
            `payment-status-badge ${isFullPayment ? "is-full-payment" : isDepositPayment ? "is-deposit-payment" : "is-payment-unknown"}`,
            isFullPayment
                ? "تم دفع المبلغ كاملاً"
                : isDepositPayment
                    ? "تم دفع نصف المبلغ (عربون)"
                    : "خطة الدفع غير متاحة"
        );
        paymentBadge.setAttribute("aria-label", isFullPayment
            ? `خطة الدفع: تم دفع المبلغ كاملاً. المبلغ: ${money(depositAmount)}`
            : isDepositPayment
                ? `خطة الدفع: تم دفع نصف المبلغ عربوناً. المتبقي من قيمة المنتجات: ${money(remainingAmount)}`
                : "تعذر تحديد خطة الدفع المسجلة لهذا الطلب.");
        details.insertBefore(paymentBadge, itemList);
        amounts.append(makeElement("span", "", `${isFullPayment ? "المبلغ المدفوع" : isDepositPayment ? "العربون المدفوع" : "الدفعة المسجلة"}: ${money(depositAmount)}`));
        amounts.append(makeElement("span", "", `المتبقي من قيمة المنتجات: ${money(remainingAmount)}`));
        amounts.append(makeElement("span", "", `مصاريف التوصيل (نقداً عند الاستلام): ${deliveryFee === null ? "لم تحدد بعد" : money(deliveryFee)}`));
        amounts.append(makeElement("strong", "", `إجمالي التحصيل نقداً عند الاستلام: ${cashDue === null ? "يحدد بعد ضبط رسوم التوصيل" : money(cashDue)}`));
        details.append(amounts);
        const deliveryEditor = makeElement("div", "delivery-fee-editor");
        const deliveryLabel = document.createElement("label");
        deliveryLabel.textContent = "رسوم التوصيل بالجنيه";
        const deliveryInput = document.createElement("input");
        deliveryInput.type = "number";
        deliveryInput.min = "0";
        deliveryInput.step = "0.01";
        deliveryInput.value = deliveryFee === null ? "" : String(deliveryFee);
        deliveryInput.placeholder = "أدخلي رسوم التوصيل";
        deliveryInput.setAttribute("aria-label", `رسوم التوصيل للطلب ${order.id}`);
        deliveryLabel.append(deliveryInput);
        const saveDeliveryFee = makeButton("حفظ رسوم التوصيل", "save-delivery-fee-button", async () => {
            const value = Number(deliveryInput.value);
            if (deliveryInput.value.trim() === "" || !Number.isFinite(value) || value < 0) {
                showMessage(elements.dashboardMessage, "أدخلي رسوم توصيل صحيحة لا تقل عن صفر.");
                deliveryInput.focus();
                return;
            }
            saveDeliveryFee.disabled = true;
            try {
                const fee = Math.round((value + Number.EPSILON) * 100) / 100;
                const { data, error } = await supabase.from("orders")
                    .update({ delivery_fee: fee })
                    .eq("id", order.id)
                    .select("delivery_fee")
                    .single();
                throwOnError(error);
                if (!data) throw new Error("لم يتم العثور على الطلب المطلوب تحديث رسوم توصيله.");
                order.delivery_fee = data.delivery_fee;
                renderOrders(orders);
                showMessage(elements.dashboardMessage, "تم حفظ رسوم التوصيل وتحديث مبلغ التحصيل عند الاستلام.");
            } catch (error) {
                showMessage(elements.dashboardMessage, error.message || "تعذر حفظ رسوم التوصيل.");
            } finally {
                saveDeliveryFee.disabled = false;
            }
        });
        deliveryEditor.append(deliveryLabel, saveDeliveryFee);
        details.append(deliveryEditor);
        const receipt = makeElement("div", "receipt-link");
        const receiptLabel = makeElement("span", "", "جارٍ تحميل صورة إيصال التحويل أو السكرين شوت…");
        receipt.append(receiptLabel);
        details.append(receipt);

        const actions = makeElement("div", "order-card-actions");
        const status = document.createElement("select");
        status.setAttribute("aria-label", `حالة الطلب ${order.id}`);
        Object.entries(orderStatuses).forEach(([value, label]) => {
            const option = makeElement("option", "", label);
            option.value = value;
            option.selected = order.status === value;
            status.append(option);
        });
        status.addEventListener("change", async () => {
            status.disabled = true;
            try {
                const { error } = await supabase.from("orders").update({ status: status.value }).eq("id", order.id);
                throwOnError(error);
                order.status = status.value;
                showMessage(elements.dashboardMessage, "تم تحديث حالة الطلب.");
            } catch (error) {
                status.value = order.status || "new";
                showMessage(elements.dashboardMessage, error.message || "تعذر تحديث حالة الطلب.");
            } finally {
                status.disabled = false;
            }
        });
        actions.append(status);
        const deleteButton = makeButton("حذف الطلب", "delete-order-button", async () => {
            if (!window.confirm(`سيتم حذف الطلب ${order.id} نهائياً. هل تريدين المتابعة؟`)) return;
            deleteButton.disabled = true;
            try {
                const { data, error } = await supabase.from("orders")
                    .delete()
                    .eq("id", order.id)
                    .select("id")
                    .single();
                throwOnError(error);
                if (!data) throw new Error("لم يتم العثور على الطلب المطلوب حذفه.");
                const orderIndex = orders.findIndex((entry) => entry.id === order.id);
                if (orderIndex !== -1) orders.splice(orderIndex, 1);
                card.remove();
                elements.ordersCount.textContent = new Intl.NumberFormat("ar-EG").format(orders.length);
                if (orders.length === 0) {
                    elements.ordersList.append(makeElement("p", "empty-admin-state", "لا توجد طلبات واردة حتى الآن."));
                }
                showMessage(elements.dashboardMessage, "تم حذف الطلب نهائياً.");
            } catch (error) {
                showMessage(elements.dashboardMessage, error.message || "تعذر حذف الطلب.");
            } finally {
                deleteButton.disabled = false;
            }
        });
        actions.append(deleteButton);
        card.append(details, actions);
        elements.ordersList.append(card);

        orderReceiptUrl(order).then((receiptUrl) => {
            if (!receiptUrl) {
                receiptLabel.textContent = "لا توجد صورة إيصال لهذا الطلب.";
                return;
            }
            receiptLabel.textContent = "صورة إيصال التحويل أو السكرين شوت";
            const receiptImage = makeElement("img", "receipt-preview");
            receiptImage.alt = `إيصال التحويل للطلب ${order.id}`;
            receiptImage.loading = "lazy";
            receiptImage.decoding = "async";
            const fullSizeLink = makeElement("a", "receipt-full-link", "فتح الصورة بالحجم الكامل");
            fullSizeLink.target = "_blank";
            fullSizeLink.rel = "noopener noreferrer";
            receiptImage.addEventListener("error", async (event) => {
                const imageSource = new URL(receiptImage.currentSrc || receiptImage.src, window.location.href);
                imageSource.search = "";
                console.warn("Public order receipt image failed; trying a private signed URL.", {
                    orderId: order.id,
                    receiptPath: order.receipt_path || order.receipt_url || null,
                    imageUrl: imageSource.href,
                    naturalWidth: receiptImage.naturalWidth,
                    naturalHeight: receiptImage.naturalHeight,
                    event
                });
                if (receiptImage.dataset.signedFallback === "true") {
                    console.error("Signed order receipt image failed to load.", {
                        orderId: order.id,
                        receiptPath: order.receipt_path || order.receipt_url || null,
                        imageUrl: imageSource.href,
                        event
                    });
                    receiptLabel.textContent = "تعذر تحميل صورة الإيصال. تحققي من وجود الملف وصلاحية القراءة في Supabase.";
                    return;
                }
                receiptImage.dataset.signedFallback = "true";
                try {
                    const signedUrl = await orderReceiptUrl(order, true);
                    receiptImage.src = signedUrl;
                    fullSizeLink.href = signedUrl;
                } catch (error) {
                    console.error("Could not create a signed order receipt URL.", {
                        orderId: order.id,
                        receiptPath: order.receipt_path || order.receipt_url || null,
                        error
                    });
                    receiptLabel.textContent = error.message || "تعذر إنشاء رابط آمن لصورة الإيصال.";
                }
            });
            receiptImage.src = receiptUrl;
            const previewButton = makeButton("", "receipt-preview-button", async () => {
                try {
                    const fullImageUrl = await orderReceiptUrl(order, true);
                    if (!fullImageUrl) throw new Error("رابط صورة الإيصال غير متاح.");
                    elements.receiptDialogImage.src = fullImageUrl;
                    elements.receiptDialogImage.alt = `صورة إيصال التحويل للطلب ${order.id}`;
                    elements.receiptDialogError.hidden = true;
                    elements.receiptDialog.showModal();
                } catch (error) {
                    showMessage(elements.dashboardMessage, error.message || "تعذر فتح صورة الإيصال.");
                }
            });
            previewButton.setAttribute("aria-label", `تكبير صورة إيصال التحويل للطلب ${order.id}`);
            previewButton.append(receiptImage);
            fullSizeLink.href = receiptUrl;
            receipt.append(previewButton, fullSizeLink);
        }).catch((error) => {
            console.error("Could not create an order receipt URL.", {
                orderId: order.id,
                receiptPath: order.receipt_path || order.receipt_url || null,
                error
            });
            receiptLabel.textContent = error.message || "تعذر إنشاء رابط صورة الإيصال. تحققي من الملف وسياسة التخزين الخاصة.";
        });
    });
}

elements.receiptDialogImage.addEventListener("error", () => {
    elements.receiptDialogError.hidden = false;
});

elements.receiptDialog.addEventListener("click", (event) => {
    if (event.target === elements.receiptDialog) elements.receiptDialog.close();
});

function fileExtension(file) {
    return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type];
}

function isSupportedImageFile(file) {
    return file.type.startsWith("image/")
        || /\.(jpe?g|png|webp|gif|bmp|tiff?|avif|heic|heif|jxl|svg)$/i.test(file.name);
}

function isHeicImage(file) {
    return /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

function loadHeicDecoder() {
    if (typeof window.heic2any === "function") return Promise.resolve(window.heic2any);
    if (heicDecoderPromise) return heicDecoderPromise;

    heicDecoderPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = HEIC_DECODER_URL;
        script.async = true;
        script.onload = () => {
            if (typeof window.heic2any !== "function") {
                reject(new Error("تعذر تهيئة قارئ HEIC. تحققي من الاتصال ثم أعيدي المحاولة."));
                return;
            }
            resolve(window.heic2any);
        };
        script.onerror = () => reject(new Error("تعذر تحميل دعم HEIC/HEIF. تحققي من الاتصال ثم أعيدي المحاولة."));
        document.head.append(script);
    }).catch((error) => {
        heicDecoderPromise = null;
        throw error;
    });
    return heicDecoderPromise;
}

async function decodeBrowserImage(file) {
    if (typeof createImageBitmap === "function") {
        try {
            const bitmap = await createImageBitmap(file, {
                resizeWidth: MAX_IMAGE_DIMENSION,
                resizeQuality: "high"
            });
            return { image: bitmap, dispose: () => bitmap.close() };
        } catch {
            try {
                const bitmap = await createImageBitmap(file);
                return { image: bitmap, dispose: () => bitmap.close() };
            } catch {
                // Try the browser's image element decoder next.
            }
        }
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    try {
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error("تعذر فك ترميز الصورة في المتصفح."));
            image.src = objectUrl;
        });
    } catch (error) {
        URL.revokeObjectURL(objectUrl);
        throw error;
    }
    return { image, dispose: () => URL.revokeObjectURL(objectUrl) };
}

async function decodeProductImage(file) {
    try {
        return await decodeBrowserImage(file);
    } catch (browserError) {
        if (!isHeicImage(file)) {
            throw new Error("تعذر فك ترميز الصورة. اختاري صورة سليمة بصيغة يدعمها الهاتف أو المتصفح.");
        }

        const heic2any = await loadHeicDecoder();
        let converted;
        try {
            converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
        } catch (error) {
            throw new Error(`تعذر تحويل صورة HEIC/HEIF: ${error.message || browserError.message}`);
        }
        const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
        if (!(jpegBlob instanceof Blob)) throw new Error("تعذر تحويل صورة HEIC/HEIF إلى صيغة قابلة للمعالجة.");
        return decodeBrowserImage(jpegBlob);
    }
}

async function encodeProductImage(image, width, height, quality) {
    const canvas = typeof OffscreenCanvas === "function"
        ? new OffscreenCanvas(width, height)
        : document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    try {
        const context = canvas.getContext("2d");
        if (!context) throw new Error("تعذر تجهيز الصورة على هذا الجهاز.");
        context.drawImage(image, 0, 0, width, height);
        const blob = typeof canvas.convertToBlob === "function"
            ? await canvas.convertToBlob({ type: "image/webp", quality })
            : await new Promise((resolve, reject) => {
                canvas.toBlob((result) => {
                    if (result) resolve(result);
                    else reject(new Error("تعذر ضغط الصورة. جرّبي صورة أخرى."));
                }, "image/webp", quality);
            });
        if (!fileExtension(blob)) throw new Error("متصفحك لا يدعم صيغة الصور المطلوبة للرفع.");
        return blob;
    } finally {
        canvas.width = 0;
        canvas.height = 0;
    }
}

async function compressProductImage(file) {
    if (!isSupportedImageFile(file)) throw new Error("اختاري ملف صورة صالحاً.");

    const decoded = await decodeProductImage(file);
    try {
        const sourceWidth = decoded.image.width || decoded.image.naturalWidth;
        const sourceHeight = decoded.image.height || decoded.image.naturalHeight;
        if (!sourceWidth || !sourceHeight) throw new Error("تعذر قراءة أبعاد الصورة.");

        for (const maxDimension of [MAX_IMAGE_DIMENSION, 1280, 1024, 800]) {
            const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
            const width = Math.max(1, Math.round(sourceWidth * scale));
            const height = Math.max(1, Math.round(sourceHeight * scale));
            for (const quality of [0.82, 0.68]) {
                const compressed = await encodeProductImage(decoded.image, width, height, quality);
                if (compressed.size <= MAX_COMPRESSED_IMAGE_BYTES) {
                    return compressed;
                }
                if (compressed.type === "image/png") break;
            }
        }
    } finally {
        decoded.dispose();
    }
    throw new Error("تعذر تقليل حجم الصورة بما يكفي. اختاري صورة أصغر أو قللي دقتها.");
}

async function verifyImageUploadAuth() {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    throwOnError(authError);
    if (!user || user.id !== config.adminUserId || user.id !== currentUserId) {
        throw new Error("انتهت جلسة المالك أو لم تعد صالحة. سجّلي الخروج ثم الدخول بحساب المالك وأعيدي المحاولة.");
    }
}

async function uploadProductImage(file, productId, onProgress = () => {}, preparedFile = null) {
    onProgress(preparedFile ? "جارٍ استخدام الصورة المجهزة…" : "جارٍ ضغط الصورة وتجهيزها…");
    const compressedFile = preparedFile || await compressProductImage(file);
    onProgress("جارٍ رفع الصورة المضغوطة…");
    const key = `${productId}/${crypto.randomUUID()}.${fileExtension(compressedFile)}`;
    const { error } = await supabase.storage.from("products").upload(key, compressedFile, {
        contentType: compressedFile.type,
        upsert: false
    });
    if (String(error?.statusCode) === "403" || /row.level.security/i.test(error?.message || "")) {
        throw new Error("رفضت سياسة RLS رفع الصورة. شغّلي supabase-setup.sql من SQL Editor في مشروع Supabase المرتبط بالموقع، وتأكدي أن adminUserId يطابق معرّف مستخدم المالك في Authentication.");
    }
    if (/bucket not found/i.test(error?.message || "")) {
        throw new Error("لم يعثر Supabase على حاوية products في المشروع المرتبط بالموقع. تأكدي أن عنوان المشروع في supabase-config.js يطابق المشروع الذي يحتوي الحاوية.");
    }
    throwOnError(error);
    const { data } = supabase.storage.from("products").getPublicUrl(key);
    return data.publicUrl;
}

elements.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage(elements.loginError, "", false);
    elements.loginButton.disabled = true;
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: elements.loginEmail.value.trim(),
            password: elements.loginPassword.value
        });
        throwOnError(error);
        elements.loginPassword.value = "";
        await loadDashboard(data.user);
    } catch (error) {
        const invalidCredentials = error.code === "invalid_credentials"
            || error.message?.toLowerCase() === "invalid login credentials";
        showMessage(elements.loginError, invalidCredentials
            ? "خطأ في البريد الإلكتروني أو كلمة المرور، يرجى التأكد وإعادة المحاولة."
            : error.message || "تعذر تسجيل الدخول إلى Supabase.");
    } finally {
        elements.loginButton.disabled = false;
    }
});

document.querySelector("#sign-out").addEventListener("click", async (event) => {
    const signOutButton = event.currentTarget;
    signOutButton.disabled = true;
    const { error } = await supabase.auth.signOut();
    if (error) showMessage(elements.dashboardMessage, error.message || "تعذر إنهاء الجلسة.");
    currentUserId = "";
    setOwnerView("");
    signOutButton.disabled = false;
});

document.querySelectorAll(".admin-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".admin-tab").forEach((item) => {
            const selected = item === tab;
            item.classList.toggle("is-active", selected);
            item.setAttribute("aria-selected", String(selected));
        });
        document.querySelectorAll(".admin-panel").forEach((panel) => { panel.hidden = panel.id !== tab.dataset.panel; });
    });
});

elements.addProductImageUrl.addEventListener("click", () => {
    const url = elements.productImageUrl.value.trim();
    if (!url || !safeImageUrl(url)) {
        showMessage(elements.productError, "أدخلي رابط صورة صحيحاً يبدأ بـ https://.");
        return;
    }
    productImageItems.push({ url, file: null, objectUrl: "" });
    elements.productImageUrl.value = "";
    showMessage(elements.productError, "", false);
    renderProductImageItems();
});

elements.productImageFile.addEventListener("change", async () => {
    const files = [...elements.productImageFile.files];
    const invalidFile = files.find((file) => !isSupportedImageFile(file));
    if (invalidFile) {
        showMessage(elements.productError, "اختاري ملفات صور مدعومة.");
        elements.productImageFile.value = "";
        return;
    }
    const addedItems = files.map((file) => {
        const item = { url: "", file, objectUrl: "", compressedFile: null, error: "", preparing: true };
        productImageItems.push(item);
        return item;
    });
    elements.productImageFile.value = "";
    showMessage(elements.productError, "", false);
    renderProductImageItems();
    if (!addedItems.length) return;

    productImagePreparationInProgress = true;
    [...elements.productForm.elements, elements.addProductImageUrl, elements.cancelEdit]
        .forEach((control) => { control.disabled = true; });
    try {
        for (let index = 0; index < addedItems.length; index += 1) {
            const item = addedItems[index];
            showMessage(elements.productUploadStatus,
                `جارٍ تجهيز الصورة ${index + 1} من ${addedItems.length} للمعاينة والرفع…`);
            try {
                item.compressedFile = await compressProductImage(item.file);
                const previewUrl = URL.createObjectURL(item.compressedFile);
                item.url = previewUrl;
                item.objectUrl = previewUrl;
            } catch (error) {
                item.error = error.message || "تعذر تجهيز الصورة. اختاري صيغة صور يدعمها الهاتف أو المتصفح.";
                showMessage(elements.productError, item.error);
            } finally {
                item.preparing = false;
            }
            renderProductImageItems();
        }
    } finally {
        productImagePreparationInProgress = false;
        [...elements.productForm.elements, elements.addProductImageUrl, elements.cancelEdit]
            .forEach((control) => { control.disabled = false; });
        elements.productUploadStatus.hidden = true;
    }
});

elements.productForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (productSaveInProgress || productImagePreparationInProgress) return;
    showMessage(elements.productError, "", false);
    if (elements.productImageUrl.value.trim()) {
        showMessage(elements.productError, "اضغطي «إضافة رابط الصورة» أولاً لإضافتها إلى معرض المنتج.");
        return;
    }
    if (productImageItems.length === 0) {
        showMessage(elements.productError, "أضيفي صورة واحدة على الأقل للمنتج.");
        return;
    }
    const unpreparedImage = productImageItems.find((item) => item.file && !item.compressedFile);
    if (unpreparedImage) {
        showMessage(elements.productError, unpreparedImage.error || "أزيلي الصورة التي تعذر تجهيزها ثم أعيدي المحاولة.");
        return;
    }

    const id = elements.productId.value || crypto.randomUUID();
    const saveButton = document.querySelector("#save-product");
    const imageItems = [...productImageItems];
    productSaveInProgress = true;
    [...elements.productForm.elements, elements.addProductImageUrl, elements.cancelEdit]
        .forEach((control) => { control.disabled = true; });
    elements.productImageList.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    try {
        if (imageItems.some((item) => item.file)) await verifyImageUploadAuth();
        const images = [];
        for (let index = 0; index < imageItems.length; index += 1) {
            const item = imageItems[index];
            if (!item.file) {
                images.push(item.url);
                continue;
            }
            const progress = (message) => {
                showMessage(elements.productUploadStatus, `الصورة ${index + 1} من ${imageItems.length}: ${message}`);
            };
            progress("جارٍ تجهيز الرفع…");
            await new Promise((resolve) => window.setTimeout(resolve, 0));
            images.push(await uploadProductImage(item.file, id, progress, item.compressedFile));
        }
        const image = images[0];
        const { data: existing, error: existingError } = await supabase.from("products").select("created_at").eq("id", id).maybeSingle();
        throwOnError(existingError);
        const row = {
            id,
            name: elements.productName.value.trim(),
            category: elements.productCategory.value,
            category_name: categoryNames[elements.productCategory.value],
            price: Number(elements.productPrice.value),
            old_price: existing ? (products.find((product) => product.id === id)?.oldPrice ?? null) : null,
            description: elements.productDescription.value.trim(),
            image,
            images,
            alt: elements.productName.value.trim(),
            created_at: existing?.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        const { error } = await supabase.from("products").upsert(row);
        throwOnError(error);
        resetProductForm();
        await loadProducts();
        showMessage(elements.dashboardMessage, "تم حفظ المنتج ونشره في المتجر.");
    } catch (error) {
        showMessage(elements.productError, error.message || "تعذر حفظ المنتج.");
    } finally {
        [...elements.productForm.elements, elements.addProductImageUrl, elements.cancelEdit]
            .forEach((control) => { control.disabled = false; });
        elements.productImageList.querySelectorAll("button").forEach((button) => { button.disabled = false; });
        productSaveInProgress = false;
        elements.productUploadStatus.hidden = true;
        saveButton.disabled = false;
    }
});

elements.heroImageFile.addEventListener("change", () => {
    const file = elements.heroImageFile.files[0];
    if (!file) return;
    if (!isSupportedImageFile(file)) {
        showMessage(elements.heroError, "اختاري ملف صورة مدعوماً.");
        elements.heroImageFile.value = "";
        return;
    }
    heroPreparedFile = null;
    showMessage(elements.heroError, "", false);
    const saveButton = document.querySelector("#save-hero-image");
    elements.heroImageFile.disabled = true;
    saveButton.disabled = true;
    heroPreparationPromise = compressProductImage(file).then((compressedFile) => {
        heroPreparedFile = compressedFile;
        const previewUrl = URL.createObjectURL(compressedFile);
        URL.revokeObjectURL(heroPreviewObjectUrl);
        heroPreviewObjectUrl = previewUrl;
        elements.heroImagePreview.src = heroPreviewObjectUrl;
    }).catch((error) => {
        elements.heroImageFile.value = "";
        showMessage(elements.heroError, error.message || "تعذر تجهيز الصورة. اختاري صيغة صور يدعمها الهاتف أو المتصفح.");
    }).finally(() => {
        elements.heroImageFile.disabled = heroSaveInProgress;
        saveButton.disabled = heroSaveInProgress;
    });
});

elements.heroForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (heroSaveInProgress) return;
    showMessage(elements.heroError, "", false);
    const file = elements.heroImageFile.files[0];
    const url = elements.heroImageUrl.value.trim();
    if (!file && (!url || !safeImageUrl(url))) {
        showMessage(elements.heroError, "أدخلي رابط صورة صحيحاً أو ارفعي صورة جديدة.");
        return;
    }
    const saveButton = document.querySelector("#save-hero-image");
    heroSaveInProgress = true;
    saveButton.disabled = true;
    try {
        if (file) await verifyImageUploadAuth();
        let imageUrl = url;
        if (file) {
            await heroPreparationPromise;
            if (!heroPreparedFile) throw new Error("تعذر تجهيز الصورة. اختاري صورة أخرى ثم أعيدي المحاولة.");
            imageUrl = await uploadProductImage(file, "hero",
                (message) => showMessage(elements.dashboardMessage, message), heroPreparedFile);
        }
        const { error } = await supabase.from("store_settings").upsert({
            key: "hero_image",
            value: imageUrl,
            updated_at: new Date().toISOString()
        });
        throwOnError(error);
        elements.heroImageUrl.value = imageUrl;
        elements.heroImagePreview.src = safeImageUrl(imageUrl) || imageUrl;
        elements.heroImageFile.value = "";
        heroPreparedFile = null;
        if (heroPreviewObjectUrl) URL.revokeObjectURL(heroPreviewObjectUrl);
        heroPreviewObjectUrl = "";
        showMessage(elements.dashboardMessage, "تم حفظ صورة الصفحة الرئيسية.");
    } catch (error) {
        showMessage(elements.heroError, error.message || "تعذر حفظ صورة الصفحة الرئيسية.");
    } finally {
        heroSaveInProgress = false;
        elements.heroImageFile.disabled = false;
        saveButton.disabled = false;
    }
});

document.querySelector("#cancel-edit").addEventListener("click", resetProductForm);
document.querySelector("#refresh-orders").addEventListener("click", async () => {
    try {
        await loadOrders();
        showMessage(elements.dashboardMessage, "تم تحديث الطلبات.");
    } catch (error) {
        showMessage(elements.dashboardMessage, error.message || "تعذر تحديث الطلبات.");
    }
});

if (!supabase) {
    elements.loginButton.disabled = true;
    showMessage(elements.setupWarning, "أضيفي مفتاح anon/public من Supabase إلى anonKey في supabase-config.js ثم أعيدي نشر الموقع.");
} else if (!config.adminUserId || config.adminUserId === "00000000-0000-0000-0000-000000000000") {
    elements.loginButton.disabled = true;
    showMessage(elements.setupWarning, "أكملي إعداد adminUserId في supabase-config.js بعد إنشاء مستخدم المالك وتشغيل سياسات supabase-setup.sql.");
} else {
    supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
            currentUserId = "";
            setOwnerView("");
        }
    });
    supabase.auth.getSession().then(({ data, error }) => {
        if (error) {
            showMessage(elements.setupWarning, error.message || "تعذر استعادة جلسة Supabase.");
            return;
        }
        if (data.session?.user) loadDashboard(data.session.user);
    });
}
})();
