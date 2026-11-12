(() => {
const products = window.FEDAA_CATALOG.map((product) => ({ ...product }));
const supabase = window.fedaaSupabase;

const PAYMENT_DETAILS = {
    "Vodafone Cash": "01001627767",
    InstaPay: "01001627767"
};

const EGP = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 });
const MAX_RECEIPT_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_COMPRESSED_RECEIPT_BYTES = 4 * 1024 * 1024;
const MAX_RECEIPT_DIMENSION = 2200;
const HEIC_DECODER_URL = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";
const productGrid = document.querySelector("#product-grid");
const productModal = document.querySelector("#product-modal");
const cart = new Map();
let activeCategory = "all";
let searchTerm = "";
let productModalReturnFocus = null;
let activeProductId = null;
let productModalImages = [];
let productModalImageIndex = 0;
let checkoutSubmissionInProgress = false;
let suppressProductCardClick = false;
let heicDecoderPromise = null;

const formatPrice = (amount) => `${EGP.format(amount)} ج.م`;
const receiptExtension = (file) => ({
    "image/png": "png",
    "image/webp": "webp"
}[file.type]);

function isSupportedReceiptImage(file) {
    return file.type.startsWith("image/")
        || /\.(jpe?g|png|webp|gif|bmp|tiff?|avif|heic|heif|jxl)$/i.test(file.name);
}

function isHeicReceipt(file) {
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

async function decodeReceiptImage(file) {
    if (typeof createImageBitmap === "function") {
        try {
            const bitmap = await createImageBitmap(file);
            return { image: bitmap, dispose: () => bitmap.close() };
        } catch {
            // Fall through to the image element decoder and HEIC fallback.
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
        return { image, dispose: () => URL.revokeObjectURL(objectUrl) };
    } catch (browserError) {
        URL.revokeObjectURL(objectUrl);
        if (!isHeicReceipt(file)) throw browserError;

        const heic2any = await loadHeicDecoder();
        let converted;
        try {
            converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
        } catch (error) {
            throw new Error(`تعذر تحويل صورة HEIC/HEIF: ${error.message || browserError.message}`);
        }
        const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
        if (!(jpegBlob instanceof Blob)) throw new Error("تعذر تحويل صورة HEIC/HEIF إلى صيغة قابلة للمعالجة.");
        return decodeReceiptImage(jpegBlob);
    }
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("تعذر ضغط صورة الإيصال. اختاري صورة أخرى."));
        }, type, quality);
    });
}

async function compressCheckoutReceipt(file) {
    if (!isSupportedReceiptImage(file)) throw new Error("اختاري ملف صورة صالحاً، مثل JPG أو PNG أو HEIC.");
    if (file.size > MAX_RECEIPT_SOURCE_BYTES) {
        throw new Error("حجم الصورة يتجاوز ٥٠ ميجابايت. اختاري صورة أصغر.");
    }

    const decoded = await decodeReceiptImage(file);
    try {
        const sourceWidth = decoded.image.width || decoded.image.naturalWidth;
        const sourceHeight = decoded.image.height || decoded.image.naturalHeight;
        if (!sourceWidth || !sourceHeight) throw new Error("تعذر قراءة أبعاد صورة الإيصال.");

        for (const maxDimension of [MAX_RECEIPT_DIMENSION, 1800, 1440, 1080]) {
            const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
            const width = Math.max(1, Math.round(sourceWidth * scale));
            const height = Math.max(1, Math.round(sourceHeight * scale));
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            try {
                const context = canvas.getContext("2d");
                if (!context) throw new Error("تعذر تجهيز صورة الإيصال على هذا الجهاز.");
                context.drawImage(decoded.image, 0, 0, width, height);
                for (const quality of [0.86, 0.78, 0.7, 0.62, 0.54]) {
                    const compressed = await canvasToBlob(canvas, "image/webp", quality);
                    if (compressed.type === "image/png") {
                        if (compressed.size <= MAX_COMPRESSED_RECEIPT_BYTES) {
                            return new File([compressed], "receipt.png", {
                                type: "image/png",
                                lastModified: Date.now()
                            });
                        }
                        break;
                    }
                    if (compressed.type !== "image/webp") {
                        throw new Error("متصفحك لا يدعم تحويل صورة الإيصال. استخدمي متصفحاً أحدث.");
                    }
                    if (compressed.size <= MAX_COMPRESSED_RECEIPT_BYTES) {
                        return new File([compressed], "receipt.webp", {
                            type: "image/webp",
                            lastModified: Date.now()
                        });
                    }
                }
            } finally {
                canvas.width = 0;
                canvas.height = 0;
            }
        }
    } finally {
        decoded.dispose();
    }

    throw new Error("تعذر ضغط صورة الإيصال إلى الحجم المطلوب. اختاري صورة أصغر.");
}

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
}[character]));

function productImages(product) {
    const images = Array.isArray(product.images)
        ? product.images.filter((image) => typeof image === "string" && image.trim())
        : [];
    return images.length > 0 ? images : (product.image ? [product.image] : []);
}

function safeImageUrl(value) {
    try {
        const imageUrl = new URL(value, window.location.href);
        return ["https:", "http:"].includes(imageUrl.protocol) ? imageUrl.href : "";
    } catch {
        return "";
    }
}

function renderProducts() {
    const sortMode = document.querySelector("#sort-select").value;
    let visibleProducts = products.filter((product) => {
        const matchesCategory = activeCategory === "all" || product.category === activeCategory;
        const matchesSearch = `${product.name} ${product.categoryName}`.includes(searchTerm);
        return matchesCategory && matchesSearch;
    });

    if (sortMode === "price-asc") visibleProducts = visibleProducts.toSorted((a, b) => a.price - b.price);
    if (sortMode === "price-desc") visibleProducts = visibleProducts.toSorted((a, b) => b.price - a.price);

    productGrid.innerHTML = visibleProducts.map((product, index) => {
        const images = productImages(product);
        const galleryControls = images.length > 1
            ? `<div class="gallery-dots" role="group" aria-label="صور ${escapeHtml(product.name)}">${images.map((image, imageIndex) => `
                <button class="gallery-dot${imageIndex === 0 ? " is-active" : ""}" type="button" data-gallery-index-target="${imageIndex}" aria-label="عرض الصورة ${imageIndex + 1}" aria-pressed="${imageIndex === 0}"></button>`).join("")}
              </div>`
            : "";
        return `
    <article class="product-card" tabindex="0" role="group" aria-label="تفاصيل ${escapeHtml(product.name)}" style="animation-delay:${Math.min(index * 45, 225)}ms">
      <div class="product-image-wrap" data-gallery-index="0" data-gallery-length="${images.length}">
                <img class="product-image" src="${escapeHtml(safeImageUrl(images[0]))}" alt="${escapeHtml(product.alt)}" loading="lazy">
                ${galleryControls}
                ${product.badge ? `<span class="product-badge">${escapeHtml(product.badge)}</span>` : ""}
                <button class="quick-add" type="button" data-add="${escapeHtml(product.id)}" aria-label="أضيفي ${escapeHtml(product.name)} إلى السلة"><span aria-hidden="true">＋</span> أضيفي للسلة</button>
      </div>
      <div class="product-meta">
                <span class="product-category">${escapeHtml(product.categoryName)}</span>
                <div class="product-name-price"><h3>${escapeHtml(product.name)}</h3><span class="product-price">${formatPrice(product.price)}${product.oldPrice ? `<span class="product-old-price">${formatPrice(product.oldPrice)}</span>` : ""}</span></div>
                ${product.description ? `<p class="product-description">${escapeHtml(product.description)}</p>` : ""}
      </div>
    </article>`;
    }).join("");
    const emptyState = document.querySelector("#empty-state");
    emptyState.textContent = products.length === 0
        ? "لا توجد منتجات حالياً. أضيفي المنتجات من لوحة الإدارة."
        : "ملقيناش قطع مطابقة. جرّبي كلمة تانية أو اختاري قسم مختلف.";
    emptyState.hidden = visibleProducts.length > 0;
}

function cartTotal() {
    return [...cart].reduce((sum, [id, quantity]) => {
        const product = products.find((item) => item.id === id);
        return sum + (product ? product.price * quantity : 0);
    }, 0);
}

function renderCart() {
    const activeCart = [...cart].filter(([id]) => products.some((product) => product.id === id));
    const count = activeCart.reduce((sum, [, quantity]) => sum + quantity, 0);
    const total = cartTotal();
    document.querySelector("#cart-count").textContent = EGP.format(count);
    document.querySelector("#cart-empty").hidden = count > 0;
    document.querySelector("#cart-bottom").hidden = count === 0;
    document.querySelector("#cart-total").textContent = formatPrice(total);
    document.querySelector("#checkout-total").textContent = formatPrice(total);
    updatePaymentAmounts(total);
    document.querySelector("#shipping-note").textContent = "يُحسب سعر الشحن حسب المحافظة";

    document.querySelector("#cart-items").innerHTML = activeCart.map(([id, quantity]) => {
        const product = products.find((item) => item.id === id);
        return `<article class="cart-line">
            <img src="${escapeHtml(safeImageUrl(product.image))}" alt="${escapeHtml(product.alt)}">
            <div class="cart-line-info"><div><h3>${escapeHtml(product.name)}</h3><p>${formatPrice(product.price)}</p></div>
                <div class="quantity-control" aria-label="الكمية"><button type="button" data-quantity="${escapeHtml(id)}" data-change="-1" aria-label="تقليل الكمية">−</button><span>${EGP.format(quantity)}</span><button type="button" data-quantity="${escapeHtml(id)}" data-change="1" aria-label="زيادة الكمية">＋</button></div>
      </div>
            <div class="cart-line-end"><strong>${formatPrice(product.price * quantity)}</strong><button class="remove-item" type="button" data-remove="${escapeHtml(id)}">حذف</button></div>
    </article>`;
    }).join("");

    updatePaymentInstructions();
}

function openPanel(panel) {
    document.querySelector("#overlay").hidden = false;
    document.body.classList.add("lock-scroll");
    panel.inert = false;
    panel.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => panel.classList.add("is-open"));
}

function closePanels() {
    const cartPanel = document.querySelector("#cart-panel");
    const checkoutModal = document.querySelector("#checkout-modal");
    const wasProductModalOpen = productModal.classList.contains("is-open");
    cartPanel.classList.remove("is-open");
    checkoutModal.classList.remove("is-open");
    productModal.classList.remove("is-open");
    cartPanel.setAttribute("aria-hidden", "true");
    checkoutModal.setAttribute("aria-hidden", "true");
    productModal.setAttribute("aria-hidden", "true");
    cartPanel.inert = true;
    checkoutModal.inert = true;
    productModal.inert = true;
    document.querySelector("#overlay").hidden = true;
    document.body.classList.remove("lock-scroll");
    if (wasProductModalOpen && productModalReturnFocus?.isConnected) productModalReturnFocus.focus();
    productModalReturnFocus = null;
    activeProductId = null;
}

function openProductModal(product, returnFocus) {
    productModalImages = productImages(product);
    productModalImageIndex = 0;
    document.querySelector("#product-modal-title").textContent = product.name;
    updateProductModalImage();
    document.querySelector("#product-modal-image").alt = product.alt || product.name;
    document.querySelector("#product-modal-category").textContent = product.categoryName || "";
    document.querySelector("#product-modal-price").textContent = formatPrice(product.price);
    document.querySelector("#product-modal-description").textContent = product.description || "لا يتوفر وصف إضافي لهذا المنتج.";
    document.querySelector("#product-modal-quantity").value = "1";
    activeProductId = product.id;
    productModalReturnFocus = returnFocus;
    openPanel(productModal);
    document.querySelector("#close-product-modal").focus();
}

function updateProductModalImage() {
    const image = document.querySelector("#product-modal-image");
    const dots = document.querySelector("#product-modal-gallery-dots");
    const hasMultipleImages = productModalImages.length > 1;
    productModal.querySelectorAll("[data-modal-gallery-step]").forEach((button) => {
        button.hidden = !hasMultipleImages;
    });
    image.src = safeImageUrl(productModalImages[productModalImageIndex] || "");
    dots.replaceChildren();
    if (!hasMultipleImages) {
        dots.hidden = true;
        return;
    }
    dots.hidden = false;
    productModalImages.forEach((imageUrl, index) => {
        const dot = document.createElement("button");
        dot.className = `gallery-dot${index === productModalImageIndex ? " is-active" : ""}`;
        dot.type = "button";
        dot.dataset.modalGalleryIndex = String(index);
        dot.setAttribute("aria-label", `عرض الصورة ${index + 1}`);
        dot.setAttribute("aria-pressed", String(index === productModalImageIndex));
        dots.append(dot);
    });
}

function updatePaymentInstructions() {
    const selectedMethod = document.querySelector('input[name="payment-method"]:checked').value;
    const paymentPlan = document.querySelector('input[name="payment-plan"]:checked').value;
    const total = cartTotal();
    const dueNow = paymentPlan === "full" ? total : Math.round((total / 2 + Number.EPSILON) * 100) / 100;
    const remaining = total - dueNow;
    const instructions = document.querySelector(`.payment-option-action[data-payment-action="${selectedMethod}"]`);
    document.querySelectorAll(".payment-option-action").forEach((option) => {
        option.hidden = option !== instructions;
        if (option !== instructions) option.replaceChildren();
    });
    const details = PAYMENT_DETAILS[selectedMethod];
    instructions.replaceChildren();

    const action = document.createElement("a");
    action.className = "payment-action-link";
    if (selectedMethod === "Vodafone Cash") {
        const transferAmount = Number(dueNow.toFixed(2)).toString();
        const code = `*9*7*${details}*${transferAmount}#`;
        instructions.append(
            document.createTextNode(`حوّلي ${paymentPlan === "full" ? "قيمة المنتجات كاملة" : "عربون المنتجات"} ${formatPrice(dueNow)} إلى محفظة فودافون كاش ${details}. كود التحويل السريع: `)
        );
        const codeDisplay = document.createElement("code");
        codeDisplay.className = "payment-ussd-code";
        codeDisplay.dir = "ltr";
        codeDisplay.textContent = code;
        instructions.append(codeDisplay, document.createTextNode(" أو اضغطي لفتحه في تطبيق الاتصال."));
        action.href = `tel:${encodeURIComponent(code)}`;
        action.textContent = "فتح الاتصال بكود التحويل";
        action.setAttribute("aria-label", `فتح الاتصال بكود تحويل ${formatPrice(dueNow)} إلى ${details}`);
    } else {
        const isAppleDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent)
            || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        action.href = isAppleDevice
            ? "https://apps.apple.com/eg/app/instapay-egypt/id1592108795"
            : "https://play.google.com/store/apps/details?id=com.egyptianbanks.instapay";
        action.textContent = "فتح أو تثبيت InstaPay";
        action.setAttribute("aria-label", `فتح صفحة InstaPay الرسمية لمتابعة التحويل إلى رقم الموبايل ${details}`);
        instructions.append(document.createTextNode(
            `حوّلي ${paymentPlan === "full" ? "قيمة المنتجات كاملة" : "عربون المنتجات"} ${formatPrice(dueNow)} عبر ${selectedMethod} إلى ${details}، ثم ارفعي صورة الإيصال. المتبقي من قيمة المنتجات عند الاستلام: ${formatPrice(remaining)}، بالإضافة إلى رسوم التوصيل التي تحددها الإدارة وتُدفع نقداً عند الاستلام. `
        ));
    }
    instructions.append(action);
}

function updatePaymentAmounts(total = cartTotal()) {
    const paymentPlan = document.querySelector('input[name="payment-plan"]:checked').value;
    const dueNow = paymentPlan === "full" ? total : Math.round((total / 2 + Number.EPSILON) * 100) / 100;
    document.querySelector("#deposit-total").textContent = formatPrice(dueNow);
    const remainingProducts = Math.max(0, total - dueNow);
    document.querySelector("#remaining-total").textContent = remainingProducts > 0
        ? `${formatPrice(remainingProducts)} + رسوم التوصيل`
        : "رسوم التوصيل فقط";
    document.querySelector("#deposit-label").textContent = paymentPlan === "full" ? "المبلغ المطلوب الآن (كامل المبلغ)" : "المبلغ المطلوب الآن (٥٠٪)";
}

document.querySelector("#all-count").textContent = EGP.format(products.length);
document.querySelector("#current-year").textContent = new Date().getFullYear();
renderProducts();
renderCart();
updatePaymentInstructions();

if (supabase) {
    supabase.from("products").select("*").order("created_at")
        .then(({ data, error }) => {
            if (error) throw error;
            products.splice(0, products.length, ...(data || []).map((product) => {
                const images = Array.isArray(product.images) && product.images.length > 0
                    ? product.images
                    : [product.image];
                return {
                    id: product.id,
                    name: product.name,
                    category: product.category,
                    categoryName: product.category_name,
                    price: Number(product.price),
                    oldPrice: product.old_price == null ? undefined : Number(product.old_price),
                    description: product.description,
                    image: images[0],
                    images,
                    alt: product.alt,
                    badge: product.badge
                };
            }));
            renderProducts();
            renderCart();
        })
        .catch((error) => {
            console.error("Supabase product load error:", error);
            const warning = document.querySelector("#store-data-warning");
            warning.textContent = error.message?.includes("Could not find the table")
                ? "قاعدة البيانات غير مهيأة بعد؛ شغّلي ملف supabase-setup.sql من Supabase SQL Editor."
                : "تعذر تحميل المنتجات من قاعدة البيانات.";
            warning.hidden = false;
        });
    supabase.from("store_settings").select("value").eq("key", "hero_image").maybeSingle()
        .then(({ data, error }) => {
            if (error) throw error;
            if (data?.value) document.querySelector("#hero-image").src = safeImageUrl(data.value);
        })
        .catch((error) => {
            console.error("Supabase hero image load error:", error);
        });
} else {
    const warning = document.querySelector("#store-data-warning");
    warning.textContent = "لم يتم إعداد اتصال Supabase؛ لا يمكن تحميل المنتجات المحفوظة.";
    warning.hidden = false;
}

productGrid.addEventListener("click", (event) => {
    if (suppressProductCardClick) {
        suppressProductCardClick = false;
        return;
    }
    const galleryButton = event.target.closest("[data-gallery-index-target]");
    if (galleryButton) {
        const wrap = galleryButton.closest(".product-image-wrap");
        setCardGalleryImage(wrap, Number(galleryButton.dataset.galleryIndexTarget));
        return;
    }
    const addButton = event.target.closest("[data-add]");
    if (addButton) {
        const id = addButton.dataset.add;
        cart.set(id, (cart.get(id) || 0) + 1);
        renderCart();
        addButton.innerHTML = '<span aria-hidden="true">✓</span> اتضافت للسلة';
        window.setTimeout(() => { if (addButton.isConnected) addButton.innerHTML = '<span aria-hidden="true">＋</span> أضيفي للسلة'; }, 1100);
        return;
    }

    if (event.target.closest("button, a, input, select, textarea")) return;
    const productCard = event.target.closest(".product-card");
    if (!productCard) return;
    const product = products.find((item) => item.id === productCard.querySelector("[data-add]").dataset.add);
    if (product) openProductModal(product, productCard);
});

productModal.addEventListener("click", (event) => {
    const galleryButton = event.target.closest("[data-modal-gallery-index]");
    const stepButton = event.target.closest("[data-modal-gallery-step]");
    if (productModalImages.length < 2) return;
    if (stepButton) {
        productModalImageIndex = (
            productModalImageIndex + Number(stepButton.dataset.modalGalleryStep) + productModalImages.length
        ) % productModalImages.length;
    } else if (galleryButton) {
        productModalImageIndex = Number(galleryButton.dataset.modalGalleryIndex);
    } else {
        return;
    }
    updateProductModalImage();
});

productModal.addEventListener("pointerdown", (event) => {
    const imageWrap = event.target.closest(".product-modal-image-wrap");
    if (!imageWrap || event.target.closest("button")) return;
    imageWrap.dataset.swipeStartX = String(event.clientX);
    imageWrap.dataset.swipeStartY = String(event.clientY);
});

productModal.addEventListener("pointerup", (event) => {
    const imageWrap = event.target.closest(".product-modal-image-wrap");
    if (!imageWrap || imageWrap.dataset.swipeStartX === undefined) return;
    const deltaX = event.clientX - Number(imageWrap.dataset.swipeStartX);
    const deltaY = event.clientY - Number(imageWrap.dataset.swipeStartY);
    delete imageWrap.dataset.swipeStartX;
    delete imageWrap.dataset.swipeStartY;
    if (Math.abs(deltaX) < 40 || Math.abs(deltaX) <= Math.abs(deltaY) || productModalImages.length < 2) return;
    productModalImageIndex = (
        productModalImageIndex + (deltaX < 0 ? 1 : -1) + productModalImages.length
    ) % productModalImages.length;
    updateProductModalImage();
});

function setCardGalleryImage(wrap, imageIndex) {
    const productCard = wrap.closest(".product-card");
    const product = products.find((item) => item.id === productCard.querySelector("[data-add]").dataset.add);
    if (!product) return;
    const images = productImages(product);
    if (images.length < 2) return;
    const nextIndex = (imageIndex + images.length) % images.length;
    wrap.dataset.galleryIndex = String(nextIndex);
    wrap.querySelector(".product-image").src = safeImageUrl(images[nextIndex]);
    wrap.querySelectorAll("[data-gallery-index-target]").forEach((dot, index) => {
        const active = index === nextIndex;
        dot.classList.toggle("is-active", active);
        dot.setAttribute("aria-pressed", String(active));
    });
}

productGrid.addEventListener("pointerdown", (event) => {
    const imageWrap = event.target.closest(".product-image-wrap");
    if (!imageWrap || event.target.closest("button")) return;
    imageWrap.dataset.swipeStartX = String(event.clientX);
    imageWrap.dataset.swipeStartY = String(event.clientY);
});

productGrid.addEventListener("pointerup", (event) => {
    const imageWrap = event.target.closest(".product-image-wrap");
    if (!imageWrap || imageWrap.dataset.swipeStartX === undefined) return;
    const deltaX = event.clientX - Number(imageWrap.dataset.swipeStartX);
    const deltaY = event.clientY - Number(imageWrap.dataset.swipeStartY);
    delete imageWrap.dataset.swipeStartX;
    delete imageWrap.dataset.swipeStartY;
    if (Math.abs(deltaX) < 40 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    const index = Number(imageWrap.dataset.galleryIndex) + (deltaX < 0 ? 1 : -1);
    setCardGalleryImage(imageWrap, index);
    suppressProductCardClick = true;
    window.setTimeout(() => { suppressProductCardClick = false; }, 0);
});

productGrid.addEventListener("keydown", (event) => {
    if ((event.key !== "Enter" && event.key !== " ") || !event.target.matches(".product-card")) return;
    event.preventDefault();
    const product = products.find((item) => item.id === event.target.querySelector("[data-add]").dataset.add);
    if (product) openProductModal(product, event.target);
});

document.querySelector("#product-modal-add").addEventListener("click", () => {
    const product = products.find((item) => item.id === activeProductId);
    const quantityInput = document.querySelector("#product-modal-quantity");
    const quantity = quantityInput.valueAsNumber;
    if (!product || !Number.isInteger(quantity) || quantity < 1) {
        quantityInput.setCustomValidity("اختاري كمية صحيحة لا تقل عن ١.");
        quantityInput.reportValidity();
        return;
    }
    quantityInput.setCustomValidity("");
    cart.set(product.id, (cart.get(product.id) || 0) + quantity);
    renderCart();
    closePanels();
});

document.querySelector("#cart-items").addEventListener("click", (event) => {
    const quantityButton = event.target.closest("[data-quantity]");
    const removeButton = event.target.closest("[data-remove]");
    if (quantityButton) {
        const id = quantityButton.dataset.quantity;
        const nextQuantity = (cart.get(id) || 0) + Number(quantityButton.dataset.change);
        if (nextQuantity > 0) cart.set(id, nextQuantity);
        else cart.delete(id);
        renderCart();
    }
    if (removeButton) {
        cart.delete(removeButton.dataset.remove);
        renderCart();
    }
});

document.querySelectorAll(".filter-button").forEach((button) => {
    button.addEventListener("click", () => {
        activeCategory = button.dataset.category;
        document.querySelectorAll(".filter-button").forEach((filter) => {
            const isActive = filter === button;
            filter.classList.toggle("is-active", isActive);
            filter.setAttribute("aria-pressed", String(isActive));
        });
        renderProducts();
    });
});

document.querySelectorAll("[data-nav-category]").forEach((link) => {
    link.addEventListener("click", () => {
        activeCategory = link.dataset.navCategory;
        document.querySelectorAll(".filter-button").forEach((filter) => {
            const isActive = filter.dataset.category === activeCategory;
            filter.classList.toggle("is-active", isActive);
            filter.setAttribute("aria-pressed", String(isActive));
        });
        renderProducts();
    });
});

document.querySelector("#search-input").addEventListener("input", (event) => {
    searchTerm = event.target.value.trim().toLocaleLowerCase("ar");
    renderProducts();
});
document.querySelector("#sort-select").addEventListener("change", renderProducts);
document.querySelector("#cart-trigger").addEventListener("click", () => openPanel(document.querySelector("#cart-panel")));
document.querySelector("#close-cart").addEventListener("click", closePanels);
document.querySelector("#close-product-modal").addEventListener("click", closePanels);
document.querySelector("#overlay").addEventListener("click", closePanels);
document.querySelector("#continue-shopping").addEventListener("click", closePanels);
document.querySelector("#checkout-trigger").addEventListener("click", () => {
    document.querySelector("#cart-panel").classList.remove("is-open");
    document.querySelector("#cart-panel").setAttribute("aria-hidden", "true");
    document.querySelector("#cart-panel").inert = true;
    openPanel(document.querySelector("#checkout-modal"));
});
document.querySelector("#close-checkout").addEventListener("click", closePanels);
document.querySelectorAll('input[name="payment-method"], input[name="payment-plan"]').forEach((input) => input.addEventListener("change", () => {
    updatePaymentAmounts();
    updatePaymentInstructions();
}));
document.querySelector("#receipt-input").addEventListener("change", (event) => {
    const file = event.target.files[0];
    const uploadCopy = document.querySelector("#upload-copy");
    uploadCopy.replaceChildren(document.createTextNode(file ? file.name : "اختاري صورة من جهازك"));
    const hint = document.createElement("small");
    hint.textContent = file
        ? `${(file.size / 1024 / 1024).toFixed(2)} ميجابايت قبل الضغط`
        : "JPG وPNG وHEIC ولقطات الشاشة؛ ضغط تلقائي حتى ٥٠ ميجابايت";
    uploadCopy.append(hint);
});

document.querySelector(".checkout-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const sourceFile = document.querySelector("#receipt-input").files[0];
    const error = document.querySelector("#form-error");
    const submitButton = form.querySelector(".submit-order");
    if (checkoutSubmissionInProgress) return;
    error.hidden = true;
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }
    if (!supabase) {
        error.textContent = "تعذر الاتصال بقاعدة البيانات حالياً. تحققي من الاتصال وحاولي مرة أخرى.";
        error.hidden = false;
        return;
    }
    if (cart.size === 0 || cart.size > 30 || [...cart.values()].some((quantity) => quantity < 1 || quantity > 20)) {
        error.textContent = "تحققي من السلة: يجب أن تحتوي على ١ إلى ٣٠ منتجاً، وكمية من ١ إلى ٢٠ لكل منتج.";
        error.hidden = false;
        return;
    }
    const paymentOption = form.querySelector('input[name="payment-plan"]:checked')?.value;
    if (paymentOption !== "deposit" && paymentOption !== "full") {
        error.textContent = "اختاري دفع نصف المبلغ أو دفع المبلغ كاملاً قبل تأكيد الطلب.";
        error.hidden = false;
        return;
    }
    if (!sourceFile || sourceFile.size > MAX_RECEIPT_SOURCE_BYTES || !isSupportedReceiptImage(sourceFile)) {
        error.textContent = "ارفعي صورة صالحة مثل JPG أو PNG أو HEIC بحجم لا يتجاوز ٥٠ ميجابايت قبل الضغط.";
        error.hidden = false;
        return;
    }

    const orderId = crypto.randomUUID();
    const phone = form.elements.namedItem("customer_phone").value.trim();
    const governorate = form.elements.namedItem("governorate").value.trim();
    const city = form.elements.namedItem("city").value.trim();
    const address = form.elements.namedItem("customer_address").value.trim();
    const orderData = {
        id: orderId,
        customer_name: form.elements.namedItem("customer-name").value.trim(),
        customer_phone: phone,
        customer_address: [governorate, city, address].filter(Boolean).join("، "),
        governorate,
        city,
        payment_method: form.querySelector('input[name="payment-method"]:checked')?.value,
        payment_option: paymentOption,
        items: [...cart].map(([id, quantity]) => ({ id, quantity }))
    };

    checkoutSubmissionInProgress = true;
    submitButton.disabled = true;
    submitButton.textContent = "جارٍ تجهيز الطلب...";

    try {
        const file = await compressCheckoutReceipt(sourceFile);
        const receiptPath = `${orderId}/receipt.${receiptExtension(file)}`;
        orderData.receipt_path = receiptPath;
        const backupKey = `fedaa:pending-order:${orderId}`;
        try {
            localStorage.setItem(backupKey, JSON.stringify({
                format: "fedaa-order-backup",
                version: 1,
                saved_at: new Date().toISOString(),
                state: "pending",
                order: orderData,
                receipt: { name: sourceFile.name, type: file.type, size: file.size }
            }));
        } catch (storageError) {
            throw new Error(`تعذر حفظ نسخة الطلب محلياً قبل الإرسال: ${storageError.message || "مساحة التخزين غير متاحة."}`);
        }
        submitButton.textContent = "جارٍ إرسال الطلب...";
        const { error: uploadError } = await supabase.storage.from("order-receipts").upload(receiptPath, file, {
            contentType: file.type,
            upsert: false
        });
        if (uploadError) {
            throw new Error(`تعذر رفع إيصال التحويل: ${uploadError.message || "تحققي من الاتصال وحاولي مرة أخرى."}`);
        }

        const { data: savedOrder, error: orderError } = await supabase.rpc("create_order", { order_data: orderData });
        if (orderError) {
            try {
                const { error: cleanupError } = await supabase.storage.from("order-receipts").remove([receiptPath]);
                if (cleanupError) console.error("Receipt cleanup error:", cleanupError);
            } catch (cleanupError) {
                console.error("Receipt cleanup error:", cleanupError);
            }
            throw new Error(orderError.message || "رفضت قاعدة البيانات بيانات الطلب. راجعي بيانات التوصيل والسلة ثم أعيدي المحاولة.");
        }
        if (!savedOrder?.id) throw new Error("لم يتم تأكيد حفظ الطلب.");
        try {
            localStorage.removeItem(backupKey);
        } catch (storageError) {
            console.error("Order backup cleanup error:", storageError);
        }
        window.location.assign("order-sent.html");
    } catch (submissionError) {
        console.error("Order submission error:", submissionError);
        const details = submissionError.message || "خطأ تقني غير معروف.";
        error.textContent = `تعذر إرسال الطلب. ${details} تحققي من الاتصال وحاولي مرة أخرى.`;
        error.hidden = false;
    } finally {
        checkoutSubmissionInProgress = false;
        submitButton.disabled = false;
        submitButton.innerHTML = 'تأكيد الطلب <span aria-hidden="true">←</span>';
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.querySelector("#overlay").hidden) closePanels();
});
})();