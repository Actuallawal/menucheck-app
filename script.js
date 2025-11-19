window.pendingDeleteMealId = null;
window.pendingAction = null;

// ============================
// GLOBAL VARIABLES - ADD THESE
// ============================
let currentStep = 1;
let currentUser = null;
let currentCompany = null;
let pendingAction = null;
let qrCodeState = {
    isReady: false,
    imageUrl: null,
    menuUrl: null,
    imageElement: null
};
let orderSubscription = null;
let unreadOrdersCount = 0;
let notificationSound = null;
let currentExportOrders = [];
let pendingSubscriptionCallback = null;

// ------------------ CANONICAL MEALS / MODAL IMPLEMENTATIONS ------------------
// Add this once near top of script.js (after globals / supabase init)

// Canonical renderer that writes into #mealsGrid (that's what app.html uses)
function displayMeals(meals) {
  try {
    const mealsGrid = document.getElementById('mealsGrid');
    if (!mealsGrid) {
      console.error('displayMeals: #mealsGrid not found in DOM');
      return;
    }

    if (!meals || meals.length === 0) {
      mealsGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🍔</div>
          <h3>No meals yet</h3>
          <p>Add your first meal to get started</p>
          <button class="btn btn-primary" onclick="openMealModal()">Add Meal</button>
        </div>
      `;
      return;
    }

    mealsGrid.innerHTML = '';
    meals.forEach(meal => {
  const mealCard = document.createElement('div');
  mealCard.className = `meal-card ${meal.available === false ? 'unavailable' : ''}`;

  // ONLY THIS — single source of truth
  mealCard.dataset.mealId = meal.id;

  mealCard.innerHTML = `
    <div class="meal-content">
      <div class="meal-image">
        ${meal.image_url 
            ? `<img src="${meal.image_url}" alt="${meal.name}">`
            : `<div class="meal-image-placeholder">🍽️</div>`
        }
      </div>

      <div class="meal-details">
        <div class="meal-header">
          <div class="meal-info">
            <div class="meal-name">${meal.name}</div>
          </div>
          <div class="meal-price">₦${meal.price}</div>
        </div>

        <div class="meal-description">${meal.description || ''}</div>

        <div class="meal-actions">
          <button class="edit-meal-btn" data-meal-id="${meal.id}">Edit</button>
          <button class="delete-meal-btn" data-meal-id="${meal.id}">Delete</button>
        </div>

        <div class="meal-footer">
          <div class="meal-category">${meal.category}</div>
          <label class="toggle-switch">
            <input type="checkbox" 
              class="meal-available-checkbox"
              data-meal-id="${meal.id}"
              ${meal.available !== false ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    </div>
  `;
  mealsGrid.appendChild(mealCard);
});

    // ensure delegation wired after we rendered (safe-guard: call once)
    setupMealDelegation();
  } catch (err) {
    console.error('displayMeals error:', err);
  }
}

// Backwards-compat alias: if any code still calls renderMeals() forward to displayMeals()
function renderMeals(meals) {
  return displayMeals(meals);
}

// simple close utility
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('hidden');
  document.body.style.overflow = '';
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) {
    console.error("❌ openModal could not find:", id);
    return;
  }
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

// ===== Universal confirmation modal helper =====
function showConfirmModal(message, onConfirm) {
    const modal = document.getElementById("confirmModal");
    const msgEl = document.getElementById("confirmMessage");
    const yesBtn = document.getElementById("confirmYes");
    const noBtn = document.getElementById("confirmNo");

    if (!modal || !msgEl || !yesBtn || !noBtn) {
        console.error("❌ Missing elements for confirm modal");
        return;
    }

    msgEl.textContent = message;

    // Remove previous listeners
    yesBtn.replaceWith(yesBtn.cloneNode(true));
    noBtn.replaceWith(noBtn.cloneNode(true));

    const newYes = document.getElementById("confirmYes");
    const newNo = document.getElementById("confirmNo");

    newYes.addEventListener("click", () => {
        modal.classList.add("hidden");
        if (typeof onConfirm === "function") onConfirm();
    });

    newNo.addEventListener("click", () => {
        modal.classList.add("hidden");
    });

    modal.classList.remove("hidden");
}

function hideConfirmModal() {
  const modal = document.getElementById("confirmModal");
  if (modal) modal.classList.add("hidden");
  document.body.style.overflow = "";
}

async function handleMealSubmit(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  const form = document.getElementById('mealForm');
  if (!form) { console.error('mealForm not found'); return; }

  const submitBtn = document.getElementById('submitMealBtn');

  const id = document.getElementById('mealId').value || null;
  const existingMealImageUrl = id ? (form.dataset.existingImage || null) : null;

  const name = (document.getElementById('mealName').value || '').trim();
  const priceRaw = (document.getElementById('mealPrice').value || '').trim();
  const price = priceRaw ? parseFloat(priceRaw) : null;
  const description = (document.getElementById('mealDescription').value || '').trim();
  const category = (document.getElementById('mealCategory').value || '').trim() || 'Uncategorized';

  const imageFile = document.getElementById('mealImage').files[0] || null;

  if (!name || price == null || isNaN(price)) {
    showToast && showToast('Please provide a meal name and valid price', 'error');
    return;
  }

  // ⭐ Start loading state
  setButtonLoading(submitBtn, true, id ? "Updating..." : "Saving...");

  let image_url = null;

  // 🔥 Upload new image if provided
  if (imageFile) {
    const filePath = `meals/${Date.now()}-${imageFile.name}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("meal-images")
      .upload(filePath, imageFile);

    if (uploadError) {
      console.error(uploadError);
      showToast("Image upload failed", "error");
    } else {
      const { data: publicUrl } = supabase.storage
        .from("meal-images")
        .getPublicUrl(filePath);

      image_url = publicUrl.publicUrl;
    }
  }

  try {
    if (!currentCompany || !currentCompany.id) {
      showToast && showToast('Company not loaded', 'error');
      return;
    }

    const payload = {
      company_id: currentCompany.id,
      name,
      price,
      description,
      category,
      available: true,
      image_url: image_url || existingMealImageUrl || null
    };

    if (!id) {
      // CREATE
      const { data, error } = await supabase
        .from('meals')
        .insert([payload])
        .select();

      if (error) throw error;
      showToast && showToast('Meal saved', 'success');
    } else {
      // UPDATE
      const { data, error } = await supabase
        .from('meals')
        .update(payload)
        .eq('id', id)
        .select();

      if (error) throw error;
      showToast && showToast('Meal updated', 'success');
    }

    form.reset();
    closeModal('mealModal');
    await loadMeals();

  } catch (error) {
    console.error('handleMealSubmit error:', error);
    showToast && showToast(error.message || 'Failed to save meal', 'error');

  } finally {
    // ⭐ End loading state
    setButtonLoading(submitBtn, false);
  }
}

function setupMealDelegation() {
  if (window._mealDelegationWired) return;
  window._mealDelegationWired = true;

  document.addEventListener("click", async (ev) => {
    // Find the nearest data-meal-id from button OR parent
    const btn = ev.target.closest(".edit-meal-btn, .delete-meal-btn, .meal-available-checkbox");
    if (!btn) return;

    const mealId =
      btn.dataset.mealId ||
      btn.getAttribute("data-meal-id") ||
      btn.closest("[data-meal-id]")?.dataset.mealId;

    if (!mealId || mealId.length < 10) {
      console.error("❌ INVALID mealId:", mealId);
      return;
    }

    // ===== EDIT =====
    if (btn.classList.contains("edit-meal-btn")) {
      ev.preventDefault();
      const { data: meal, error } = await supabase.from("meals").select("*").eq("id", mealId).single();
      if (error || !meal) return showToast("Error loading meal", "error");
      openMealModal("edit", meal);
      return;
    }

    // ===== DELETE =====
    if (btn.classList.contains("delete-meal-btn")) {
    ev.preventDefault();

    // Save globally
    window.pendingDeleteMealId = mealId;

    // Define delete action
    window.pendingAction = async function () {
        const { error } = await supabase
            .from("meals")
            .delete()
            .eq("id", window.pendingDeleteMealId);

        if (!error) {
            showToast("Meal deleted", "success");
            loadMeals();
        } else {
            console.error(error);
            showToast("Error deleting meal", "error");
        }
    };

    // Open your UI modal
    openModal('confirmModal');
    return;
}
  });

  // ===== AVAILABILITY =====
  document.addEventListener("change", async (ev) => {
    if (!ev.target.classList.contains("meal-available-checkbox")) return;
    const mealId = ev.target.dataset.mealId;
    const newAvailable = ev.target.checked;

    const { error } = await supabase
      .from("meals")
      .update({ available: newAvailable })
      .eq("id", mealId);

    if (error) return showToast("Error updating availability", "error");

    showToast("Meal updated", "success");
  });
}


// 🔥 LEGACY SHIMS — PASTE THIS BLOCK EXACTLY HERE (NOWHERE ELSE)
// ===================================================================
if (typeof setupUnifiedMealDelegation === 'undefined') {
  var setupUnifiedMealDelegation = function() {
    return setupMealDelegation();
  };
}

if (typeof displayMeals === 'undefined') {
  var displayMeals = function(m) {
    return renderMeals ? renderMeals(m) :
           (window.displayMeals && window.displayMeals(m));
  };
}

// WhatsApp configuration functions
function toggleWhatsAppFields() {
    console.log('📱 Toggling WhatsApp fields...');
    
    const enableWhatsApp = document.getElementById('regEnableWhatsApp');
    const whatsappFields = document.getElementById('whatsappFields');
    
    console.log('Enable WhatsApp checked:', enableWhatsApp?.checked);
    console.log('WhatsApp fields element:', whatsappFields);
    
    if (enableWhatsApp && whatsappFields) {
        if (enableWhatsApp.checked) {
            whatsappFields.style.display = 'block';
            whatsappFields.style.opacity = '1';
            console.log('✅ WhatsApp fields shown');
        } else {
            whatsappFields.style.display = 'none';
            whatsappFields.style.opacity = '0';
            console.log('✅ WhatsApp fields hidden');
        }
    }
}

function resolveCompanyId() {
    const url = new URL(window.location.href);
    return (
        url.searchParams.get("company") ||
        url.hash.replace("#", "").split("=")[1] ||
        null
    );
}

// Toggle WhatsApp fields based on checkbox
function toggleSettingsWhatsAppFields() {
    const enableWhatsApp = document.getElementById('enableWhatsApp');
    const whatsappFields = document.getElementById('settingsWhatsappFields');
    
    console.log('🔧 Toggling WhatsApp fields:', {
        enableWhatsApp: !!enableWhatsApp,
        whatsappFields: !!whatsappFields,
        isChecked: enableWhatsApp?.checked
    });
    
    if (enableWhatsApp && whatsappFields) {
        if (enableWhatsApp.checked) {
            whatsappFields.style.display = 'block';
            whatsappFields.style.opacity = '1';
            console.log('✅ WhatsApp fields shown');
        } else {
            whatsappFields.style.display = 'none';
            whatsappFields.style.opacity = '0';
            console.log('✅ WhatsApp fields hidden');
        }
    } else {
        console.error('❌ WhatsApp elements not found');
    }
}

function setupSubscriptionModal() {
  console.log("🔧 Setting up subscription modal...");

  const form = document.getElementById("subscriptionForm");

  if (!form) {
    console.warn("⚠️ subscriptionForm NOT found at setup time.");
    return;
  }

  // Clean previous listeners safely
  try {
    form.removeEventListener('submit', handleSubscriptionSubmit);
  } catch (e) {}

  // Add listener directly
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    console.log("🟢 Subscription form SUBMITTED");
    handleSubscriptionSubmit(e);
  });

  // Ensure there is an email input filled if user logged in
  const emailInput = document.getElementById('email');
  if (currentUser?.email && emailInput) {
    emailInput.value = currentUser.email;
  }

  console.log("✅ Subscription modal initialized");
  // Populate saved cards table
async function loadSavedCardsForBusiness() {
  try {
    const businessId = currentCompany?.id;
    if (!businessId) return;

    const res = await fetch(`/api/paystack/cards/${businessId}`);
    const json = await res.json();
    if (!json.success) return;

    const cards = json.cards || [];
    const container = document.getElementById('paystackSavedCards');
    if (!container) return;

    if (!cards.length) {
      container.innerHTML = '<div class="empty">No saved cards</div>';
      return;
    }

    container.innerHTML = cards.map(c => `
      <div class="saved-card" data-auth="${c.authorization_code}">
        <div class="card-meta">
          <strong>${c.card_brand || 'Card'}</strong> • **** **** **** ${c.last4}
          <div class="card-date">${new Date(c.created_at).toLocaleString()}</div>
        </div>
        <div>
          <button class="use-card-btn btn btn-outline" data-auth="${c.authorization_code}" data-sub="${c.subscription_id}">Use</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('❌ loadSavedCardsForBusiness error', err);
  }
}

// Call it now
loadSavedCardsForBusiness();

// =============================
// Start Subscription
// =============================
const startBtn = document.getElementById("startSubscriptionBtn");
if (startBtn) {
  startBtn.onclick = async function () {
    try {
      showLoading("Connecting to Paystack...");

      const email = currentUser?.email;
      const business_id = currentCompany?.id;
      const user_id = currentUser?.id;
      const amount = 23999; // NAIRA

      const res = await fetch("/api/paystack/initialize-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, business_id, user_id, amount })
      });

      const data = await res.json();
      hideLoading();

      if (!data || !data.authorization_url) {
        showToast("Failed to initialize subscription", "error");
        return;
      }

      // Load Paystack iframe
      const iframeBox = document.getElementById("paystackCardFrame");
      iframeBox.innerHTML = `
        <iframe src="${data.authorization_url}"
          style="width:100%; height:560px; border:0; border-radius:10px;">
        </iframe>
      `;
    } catch (err) {
      hideLoading();
      console.error(err);
      showToast("Subscription setup failed", "error");
    }
  };
}

}

// =============================
// Use a saved card for renewal
// =============================
document.addEventListener("click", async function (e) {
  const useBtn = e.target.closest(".use-card-btn");
  if (!useBtn) return;

  const authCode = useBtn.dataset.auth;
  const subId = useBtn.dataset.sub;
  const business_id = currentCompany?.id;

  if (!authCode || !business_id) {
    showToast("Invalid saved card", "error");
    return;
  }

  try {
    showLoading("Activating subscription...");

    const res = await fetch("/api/paystack/use-saved-card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authorization_code: authCode,
        subscription_id: subId,
        business_id,
      }),
    });

    const json = await res.json();
    hideLoading();

    if (!json.success) {
      showToast(json.error || "Failed to process saved card", "error");
      return;
    }

    showToast("Subscription Activated Successfully!", "success");
    closeModal('subscriptionModal');
    await checkSubscriptionAccess();

  } catch (err) {
    hideLoading();
    console.error(err);
    showToast("Something went wrong using this card", "error");
  }
});

// Load WhatsApp settings
async function loadWhatsAppSettings() {
    if (!currentCompany) {
        // Try to load from localStorage as fallback
        const savedSettings = localStorage.getItem('whatsappSettings');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            updateWhatsAppSettingsUI(settings);
            return;
        }
        return;
    }
    
    try {
        console.log('📱 Loading WhatsApp settings...');
        
        const { data: company, error } = await supabase
            .from('companies')
            .select('enable_whatsapp_notifications, whatsapp_number, whatsapp_message_template')
            .eq('id', currentCompany.id)
            .single();
            
        if (error) {
            console.warn('⚠️ Using default WhatsApp settings');
            // Save defaults to localStorage
            const defaultSettings = {
                enable_whatsapp_notifications: true,
                whatsapp_number: '2348075640610',
                whatsapp_message_template: getDefaultWhatsAppTemplate()
            };
            localStorage.setItem('whatsappSettings', JSON.stringify(defaultSettings));
            updateWhatsAppSettingsUI(defaultSettings);
            return;
        }
        
        if (company) {
            // Save to localStorage for persistence
            localStorage.setItem('whatsappSettings', JSON.stringify(company));
            updateWhatsAppSettingsUI(company);
            console.log('✅ WhatsApp settings loaded successfully');
        }
    } catch (error) {
        console.error('❌ Error loading WhatsApp settings:', error);
        // Fallback to localStorage
        const savedSettings = localStorage.getItem('whatsappSettings');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            updateWhatsAppSettingsUI(settings);
        } else {
            initializeWhatsAppWithDefaults();
        }
    }
}
function initializeWhatsAppWithDefaults() {
    console.log('🔄 Initializing WhatsApp with defaults');
    
    const defaultSettings = {
        enable_whatsapp_notifications: true,
        whatsapp_number: '2348075640610',
        whatsapp_message_template: getDefaultWhatsAppTemplate()
    };
    
    updateWhatsAppSettingsUI(defaultSettings);
    
    // Also save to localStorage for persistence
    localStorage.setItem('whatsappSettings', JSON.stringify(defaultSettings));
}

async function saveWhatsAppSettings() {
    console.log('💾 Saving WhatsApp settings...');
    
    if (!currentCompany) {
        showToast('Please wait for company data to load', 'error');
        return;
    }
    
    const saveBtn = document.getElementById('saveWhatsAppBtn');
    const enableWhatsApp = document.getElementById('enableWhatsApp')?.checked ?? true;
    const whatsappNumber = document.getElementById('whatsappNumber')?.value.trim() || '2348075640610';
    const whatsappTemplate = document.getElementById('whatsappTemplate')?.value || getDefaultWhatsAppTemplate();
    
    // Validate WhatsApp number
    if (enableWhatsApp && !isValidWhatsAppNumber(whatsappNumber)) {
        showToast('Please enter a valid WhatsApp number', 'error');
        return;
    }
    
    try {
        setButtonLoading(saveBtn, true, 'Saving...');
        
        const updateData = {
            enable_whatsapp_notifications: enableWhatsApp,
            whatsapp_number: whatsappNumber,
            whatsapp_message_template: whatsappTemplate,
            updated_at: new Date().toISOString()
        };
        
        console.log('📦 Saving WhatsApp data:', updateData);
        
        // Try to update database
        const { error } = await supabase
            .from('companies')
            .update(updateData)
            .eq('id', currentCompany.id);
            
        if (error) {
            console.error('❌ Database save error:', error);
            // If columns don't exist, show instruction
            if (error.code === '42703') {
                showToast(
                    'Database needs update for WhatsApp features. Please run the SQL migration.',
                    'error'
                );
                return;
            }
            throw error;
        }
        
        // Update current company data
        if (currentCompany) {
            currentCompany.enable_whatsapp_notifications = enableWhatsApp;
            currentCompany.whatsapp_number = whatsappNumber;
            currentCompany.whatsapp_message_template = whatsappTemplate;
        }
        
        // Save to localStorage for backup
        localStorage.setItem('whatsappSettings', JSON.stringify(updateData));
        
        console.log('✅ WhatsApp settings saved successfully');
        showToast('✅ WhatsApp settings saved successfully!', 'success');
        
    } catch (error) {
        console.error('❌ Error saving WhatsApp settings:', error);
        showToast('Error saving WhatsApp settings: ' + error.message, 'error');
    } finally {
        setButtonLoading(saveBtn, false);
    }
}

function setupSupportForm() {
    const supportForm = document.getElementById('supportForm');
    if (supportForm) {
        supportForm.removeEventListener('submit', handleSupportSubmit);
        supportForm.addEventListener('submit', function(e) {
            e.preventDefault();
            handleSupportSubmit(e);
        });
    }
}

async function checkSubscriptionAccess() {
    if (!currentCompany?.id) {
        console.warn("No company loaded — cannot check subscription.");
        return true; // prevent blocking login
    }

    const { data, error } = await supabase
        .from("companies")
        .select("subscription_status, trial_end, current_period_end")
        .eq("id", currentCompany.id)
        .single();

    if (error || !data) {
        console.error("Subscription lookup failed:", error);
        showToast("Cannot verify subscription status.", "error");
        return false;
    }

    const now = Date.now();
    const trialEnd = data.trial_end ? new Date(data.trial_end).getTime() : null;
    const periodEnd = data.current_period_end ? new Date(data.current_period_end).getTime() : null;

    // FREE TRIAL ACTIVE
    if (data.subscription_status === "trialing" && trialEnd && trialEnd > now) {
        console.log("✔ Trial active");
        return true;
    }

    // ACTIVE SUBSCRIPTION
    if (data.subscription_status === "active" && periodEnd && periodEnd > now) {
        console.log("✔ Subscription active");
        return true;
    }

    // GRACE PERIOD? (Optional)
    if (data.subscription_status === "incomplete" && periodEnd && periodEnd > now) {
        console.log("⚠ Grace period — allow temporary access.");
        document.getElementById("gracePeriodBanner")?.classList.remove("hidden");
        return true;
    }

    // ❌ EXPIRED / CANCELLED / FAILED PAYMENT
    console.warn("⛔ Subscription inactive — blocking access");

    blockDashboardForExpiredSubscription();
    return false;
}

function blockDashboardForExpiredSubscription() {
    showToast("Your subscription has expired. Please renew.", "error");

    // Hide all sections
    document.querySelectorAll(".content-section").forEach(sec => sec.classList.add("hidden"));

    // Show only the subscription modal
    openSubscriptionModal();

    // Optionally disable navigation clicks
    document.querySelectorAll(".nav-item, .mobile-nav-item").forEach(item => {
        item.classList.add("disabled");
    });
}


async function handleSubscriptionForm(e) {
    e.preventDefault();

    if (!currentUser || !currentCompany) {
        showToast("Unable to start subscription. Reload page.", "error");
        return;
    }

    const email = currentUser.email;
    const business_id = currentCompany.id;
    const user_id = currentUser.id;

    try {
        showLoading("Connecting to Paystack...");

        const response = await fetch("/api/paystack/initialize-subscription", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, business_id, user_id })
        });

        const result = await response.json();

        hideLoading();

        if (!result.success) {
            showToast(result.error || "Subscription initialization failed", "error");
            return;
        }

        // REDIRECT TO PAYSTACK AUTHORIZATION
        window.location.href = result.authorization_url;

    } catch (error) {
        hideLoading();
        console.error("Subscription error:", error);
        showToast("Network error starting subscription", "error");
    }
}


async function handleSupportSubmit(e) {
    e.preventDefault();
    
    const name = document.getElementById('supportName')?.value.trim();
    const email = document.getElementById('supportEmail')?.value.trim();
    const message = document.getElementById('supportMessage')?.value.trim();
    
    if (!name || !email || !message) {
        showToast('Please fill in all fields', 'error');
        return;
    }
    
    // Format WhatsApp message
    const whatsappMessage = `*Support Request*\n\n*Name:* ${name}\n*Email:* ${email}\n*Message:* ${message}\n\n*Restaurant:* ${currentCompany?.name || 'N/A'}\n*Time:* ${new Date().toLocaleString()}`;
    
    // Encode for URL
    const encodedMessage = encodeURIComponent(whatsappMessage);
    const whatsappUrl = `https://wa.me/2348111111111?text=${encodedMessage}`;
    
    // Open WhatsApp in new tab
    window.open(whatsappUrl, '_blank');
    closeModal('supportModal');
    showToast('Opening WhatsApp support...', 'success');
}



// Reset WhatsApp settings to default
function resetWhatsAppSettings() {
    if (confirm('Are you sure you want to reset WhatsApp settings to default?')) {
        document.getElementById('enableWhatsApp').checked = true;
        document.getElementById('whatsappNumber').value = '2348075640610';
        document.getElementById('whatsappTemplate').value = getDefaultWhatsAppTemplate();
        
        toggleSettingsWhatsAppFields();
        previewTemplate();
        
        showToast('WhatsApp settings reset to default', 'info');
    }
}
// Reset template to default
function resetToDefaultTemplate() {
    if (confirm('Reset message template to default?')) {
        document.getElementById('whatsappTemplate').value = getDefaultWhatsAppTemplate();
        previewTemplate();
        showToast('Template reset to default', 'info');
    }
}
// Insert placeholder into template
function insertPlaceholder(placeholder) {
    const templateInput = document.getElementById('whatsappTemplate');
    const startPos = templateInput.selectionStart;
    const endPos = templateInput.selectionEnd;
    
    templateInput.value = templateInput.value.substring(0, startPos) + 
                         placeholder + 
                         templateInput.value.substring(endPos);
    
    // Set cursor position after inserted placeholder
    templateInput.selectionStart = templateInput.selectionEnd = startPos + placeholder.length;
    templateInput.focus();
    
    // Update preview
    previewTemplate();
}
// Preview template with sample data
function previewTemplate() {
    const template = document.getElementById('whatsappTemplate').value || getDefaultWhatsAppTemplate();
    const preview = document.getElementById('templatePreview');
    
    const sampleData = {
        customer_name: 'John Doe',
        order_type: 'Dine-in',
        table_number: '5',
        payment_method: 'Bank Transfer',
        order_items: '• Jollof Rice x2 - ₦5,000\n• Chicken Pepper Soup x1 - ₦3,500\n• Chapman Drink x2 - ₦3,000',
        total_amount: '11,500'
    };
    
    let previewText = template;
    
    // Replace placeholders with sample data
    Object.keys(sampleData).forEach(key => {
        const placeholder = `{${key}}`;
        previewText = previewText.replace(new RegExp(placeholder, 'g'), sampleData[key]);
    });
    
    preview.textContent = previewText;
}
function updateWhatsAppSettingsUI(company) {
    console.log('🎯 Updating WhatsApp settings UI with:', company);
    
    const enableWhatsApp = document.getElementById('enableWhatsApp');
    const whatsappNumber = document.getElementById('whatsappNumber');
    const whatsappTemplate = document.getElementById('whatsappTemplate');
    
    if (enableWhatsApp) {
        enableWhatsApp.checked = company.enable_whatsapp_notifications !== false; // Default to true
    }
    
    if (whatsappNumber) {
        whatsappNumber.value = company.whatsapp_number || '2348075640610';
    }
    
    if (whatsappTemplate) {
        whatsappTemplate.value = company.whatsapp_message_template || getDefaultWhatsAppTemplate();
    }
    
    // Update the toggle visibility
    toggleSettingsWhatsAppFields();
    
    // Update template preview
    previewTemplate();
    
    console.log('✅ WhatsApp settings UI updated');
}

// Send test WhatsApp message
async function sendTestWhatsApp() {
    const testBtn = document.getElementById('testWhatsAppBtn');
    const enableWhatsApp = document.getElementById('enableWhatsApp')?.checked ?? true;
    const whatsappNumber = document.getElementById('whatsappNumber')?.value.trim() || '2348075640610';
    const whatsappTemplate = document.getElementById('whatsappTemplate')?.value || getDefaultWhatsAppTemplate();
    
    if (!enableWhatsApp) {
        showToast('Please enable WhatsApp notifications first', 'error');
        return;
    }
    
    if (!isValidWhatsAppNumber(whatsappNumber)) {
        showToast('Please enter a valid WhatsApp number', 'error');
        return;
    }
    
    try {
        setButtonLoading(testBtn, true, 'Sending...');
        
        const testData = {
            customer_name: 'Test Customer',
            order_type: 'Dine-in',
            table_number: 'TEST-001',
            payment_method: 'Bank Transfer',
            order_items: '• Test Meal x1 - ₦2,500\n• Test Drink x2 - ₦1,500',
            total_amount: '4,000'
        };
        
        let testMessage = whatsappTemplate;
        
        // Replace placeholders with test data
        Object.keys(testData).forEach(key => {
            const placeholder = `{${key}}`;
            testMessage = testMessage.replace(new RegExp(placeholder, 'g'), testData[key]);
        });
        
        // Add test identifier
        testMessage += `\n\n---\n*TEST MESSAGE* - Generated on ${new Date().toLocaleString()}`;
        
        // Open WhatsApp with test message
        window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(testMessage)}`, '_blank');
        
        showToast('📱 Test message opened in WhatsApp!', 'success');
        
    } catch (error) {
        console.error('❌ Error sending test message:', error);
        showToast('Error sending test message: ' + error.message, 'error');
    } finally {
        setButtonLoading(testBtn, false);
    }
}

// Utility functions
function getDefaultWhatsAppTemplate() {
    return `🛍️ *NEW ORDER*

*Customer:* {customer_name}
*Order Type:* {order_type}
*Table/Room:* {table_number}
*Payment Method:* {payment_method}

*Order Items:*
{order_items}

*Total: ₦{total_amount}*

Thank you for your order! 🎉`;
}

// Supabase configuration
const SUPABASE_URL = 'https://qohhwefxfrjaqefwveyk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvaGh3ZWZ4ZnJqYXFlZnd2ZXlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyNTM1MTEsImV4cCI6MjA3NjgyOTUxMX0.rSG7KNGtSmpu9egvhh0HjyK-OM-Q42fu2S2VZRAbRwE';

// Initialize Supabase with proper error handling
let supabase;

try {
    // Check if Supabase is available
    if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: false,
                storage: localStorage
            }
        });
        console.log('✅ Supabase client initialized successfully');
    } else {
        throw new Error('Supabase library not loaded');
    }
} catch (error) {
    console.error('❌ Supabase initialization failed:', error);
    
    // Create a fallback supabase object with basic methods
    supabase = {
        auth: {
            signInWithPassword: () => Promise.resolve({ 
                data: null, 
                error: new Error('Supabase not initialized. Please refresh the page.') 
            }),
            getSession: () => Promise.resolve({ 
                data: { session: null }, 
                error: new Error('Supabase not initialized') 
            }),
            signOut: () => Promise.resolve({ error: new Error('Supabase not initialized') })
        }
    };
    
    showToast('Supabase connection failed. Please refresh the page.', 'error');
}

function isValidWhatsAppNumber(number) {
    if (!number) return false;
    
    // Remove all non-digit characters
    const cleanNumber = number.replace(/\D/g, '');
    
    // Basic validation for Nigerian numbers (you can adjust for your country)
    const phoneRegex = /^234[789][01]\d{8}$/;
    return phoneRegex.test(cleanNumber) || cleanNumber.length >= 10;
}

function initializeWhatsAppConfig() {
    console.log('🎯 Initializing WhatsApp configuration...');
    
    // Set up event listeners
    const enableWhatsApp = document.getElementById('enableWhatsApp');
    const templateInput = document.getElementById('whatsappTemplate');
    
    if (enableWhatsApp) {
        enableWhatsApp.addEventListener('change', toggleSettingsWhatsAppFields);
    }
    
    if (templateInput) {
        templateInput.addEventListener('input', previewTemplate);
    }
    
    // Load current settings
    loadWhatsAppSettings();
    
    console.log('✅ WhatsApp configuration initialized');
}

function setButtonLoading(button, isLoading, loadingText = 'Processing...') {
    if (!button) return;

    if (isLoading) {
        button.dataset.originalText = button.textContent;
        button.disabled = true;
        button.classList.add("loading");
        button.textContent = loadingText;
    } else {
        button.disabled = false;
        button.classList.remove("loading");
        if (button.dataset.originalText) {
            button.textContent = button.dataset.originalText;
        }
    }
}

// Add this function to check UI state
function debugUIState() {
    console.log('=== UI STATE DEBUG ===');
    
    const loginScreen = document.getElementById('loginScreen');
    const dashboard = document.getElementById('dashboard');
    
    console.log('1. Login screen visible:', !loginScreen?.classList.contains('hidden'));
    console.log('2. Dashboard visible:', !dashboard?.classList.contains('hidden'));
    console.log('3. Current active section:', document.querySelector('.content-section.active')?.id);
    
    // Check if main content is loaded
    const mainContent = document.querySelector('.main-content');
    console.log('4. Main content exists:', !!mainContent);
    console.log('5. Main content children:', mainContent?.children.length);
    
    // Check navigation
    const navItems = document.querySelectorAll('.nav-item');
    console.log('6. Nav items found:', navItems.length);
    navItems.forEach((item, index) => {
        console.log(`   Nav ${index + 1}:`, item.textContent.trim(), '- Active:', item.classList.contains('active'));
    });
    
    console.log('=== END UI DEBUG ===');
}

// Run this in console
window.debugUI = debugUIState;


// Test function - run this in browser console
window.debugApp = function() {
    console.log('=== APP DEBUG INFO ===');
    console.log('1. App initialized:', window.appInitialized);
    console.log('2. Supabase:', typeof supabase);
    console.log('3. Login form:', document.getElementById('loginForm'));
    console.log('4. Login form listeners:', 
        getEventListeners(document.getElementById('loginForm')));
    console.log('5. Current user:', currentUser);
    console.log('6. Current company:', currentCompany);
    console.log('=== END DEBUG ===');
    
    // Test Supabase connection
    testSupabaseConnection();
    
    // Test if login form works
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        console.log('🎯 Login form action:', loginForm.action);
        console.log('🎯 Login form method:', loginForm.method);
    }
};



// Test function - add this to browser console
window.testSimpleLogin = async function() {
    console.log('🧪 Testing simple login...');
    
    // Test credentials (replace with actual test credentials)
    const testEmail = 'king@gmail.com';
    const testPassword = 'testpassword123';
    
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: testEmail,
            password: testPassword
        });
        
        if (error) {
            console.log('❌ Test login failed (expected):', error.message);
        } else {
            console.log('✅ Test login successful:', data.user.email);
        }
    } catch (error) {
        console.error('💥 Test login crashed:', error);
    }
};


// Test Supabase connection
async function testSupabaseAuth() {
    console.log('🔗 Testing Supabase auth connection...');
    try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
            console.error('❌ Supabase auth error:', error);
        } else {
            console.log('✅ Supabase auth working, session:', data.session);
        }
    } catch (error) {
        console.error('💥 Supabase test crashed:', error);
    }
}

// Run debug immediately
setTimeout(() => {
    testSupabaseAuth();
}, 1000);

// Mobile navigation functionality
function setupMobileNavigation() {
  const mobileMenuToggle = document.getElementById('mobileMenuToggle');
  const mobileNavOverlay = document.getElementById('mobileNavOverlay');
  const mobileClose = document.getElementById('mobileClose');
  const mobileNavItems = document.querySelectorAll('.mobile-nav-item');
  
  if (mobileMenuToggle) {
    mobileMenuToggle.addEventListener('click', function() {
      mobileNavOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  }
  
  if (mobileClose) {
    mobileClose.addEventListener('click', closeMobileNav);
  }
  
  if (mobileNavOverlay) {
    mobileNavOverlay.addEventListener('click', function(e) {
      if (e.target === mobileNavOverlay) {
        closeMobileNav();
      }
    });
  }
  
  // Mobile nav item clicks
  mobileNavItems.forEach(item => {
    item.addEventListener('click', function() {
      const section = this.getAttribute('data-section');
      showSection(section);
      closeMobileNav();
    });
  });
  
  // Close on escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && mobileNavOverlay.classList.contains('active')) {
      closeMobileNav();
    }
  });
}

function closeMobileNav() {
  const mobileNavOverlay = document.getElementById('mobileNavOverlay');
  if (mobileNavOverlay) {
    mobileNavOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }
}

// ============================
// REAL-TIME NOTIFICATION SYSTEM
// ============================

  // Load notification sound
//   notificationSound = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==');
  
//   // Setup real-time subscription for orders
//   orderSubscription = supabase
//     .channel('orders-realtime')
//     .on(
//       'postgres_changes',
//       {
//         event: 'INSERT',
//         schema: 'public',
//         table: 'orders',
//         filter: `company_id=eq.${currentCompany.id}`
//       },
//       (payload) => {
//         console.log('🆕 New order received:', payload);
//         handleNewOrder(payload.new);
//       }
//     )
//     .on(
//       'postgres_changes',
//       {
//         event: 'UPDATE',
//         schema: 'public',
//         table: 'orders',
//         filter: `company_id=eq.${currentCompany.id}`
//       },
//       (payload) => {
//         console.log('📝 Order updated:', payload);
//         handleOrderUpdate(payload.new);
//       }
//     )
//     .subscribe((status) => {
//       console.log('📡 Real-time subscription status:', status);
//     });
  
//   // Setup browser notifications
//   setupBrowserNotifications();
  
//   // Update sound indicator
//   updateSoundIndicator();

// Handle new order
function handleNewOrder(order) {
  // Increment unread orders count
  unreadOrdersCount++;
  updateNotificationBadges();
  
  // Play notification sound if enabled
  playNotificationSound();
  
  // Show browser notification
  showBrowserNotification(order);
  
  // Show in-app notification
  showInAppNotification(order);
  
  // Refresh orders list if on orders page
  if (document.getElementById('ordersSection')?.classList.contains('active')) {
    setTimeout(() => loadOrders(), 1000);
  }
  
  // Refresh dashboard if on dashboard
  if (document.getElementById('dashboardSection')?.classList.contains('active')) {
    setTimeout(() => loadDashboardData(), 1000);
  }
}

// Handle order updates
function handleOrderUpdate(order) {
  // Refresh orders list if on orders page
  if (document.getElementById('ordersSection')?.classList.contains('active')) {
    setTimeout(() => loadOrders(), 500);
  }
}

// Update notification badges
function updateNotificationBadges() {
  const desktopBadge = document.getElementById('orderNotificationBadge');
  const mobileBadge = document.getElementById('mobileOrderBadge');
  
  if (unreadOrdersCount > 0) {
    if (desktopBadge) {
      desktopBadge.textContent = unreadOrdersCount;
      desktopBadge.classList.remove('hidden');
    }
    if (mobileBadge) {
      mobileBadge.textContent = unreadOrdersCount;
      mobileBadge.classList.remove('hidden');
    }
  } else {
    if (desktopBadge) desktopBadge.classList.add('hidden');
    if (mobileBadge) mobileBadge.classList.add('hidden');
  }
}

// Play notification sound
function playNotificationSound() {
  if (notificationSound && isSoundEnabled()) {
    try {
      notificationSound.currentTime = 0;
      notificationSound.play().catch(e => console.log('Sound play failed:', e));
    } catch (error) {
      console.log('Sound play error:', error);
    }
  }
}

// Check if sound notifications are enabled
function isSoundEnabled() {
  return localStorage.getItem('notificationSound') !== 'false';
}

// Toggle sound notifications
function toggleNotificationSound() {
  const enabled = isSoundEnabled();
  localStorage.setItem('notificationSound', (!enabled).toString());
  updateSoundIndicator();
  showToast(`Sound notifications ${!enabled ? 'enabled' : 'disabled'}`, 'success');
}

// Update sound indicator
function updateSoundIndicator() {
  const soundIndicator = document.getElementById('soundIndicator');
  const soundToggle = document.getElementById('soundToggle');
  
  if (soundIndicator) {
    if (isSoundEnabled()) {
      soundIndicator.style.display = 'block';
      soundToggle?.classList.remove('muted');
    } else {
      soundIndicator.style.display = 'none';
      soundToggle?.classList.add('muted');
    }
  }
}

// Setup browser notifications
function setupBrowserNotifications() {
  if ('Notification' in window) {
    if (Notification.permission === 'default') {
      // Request permission when user interacts with orders section
      const ordersNav = document.querySelector('[data-section="orders"]');
      if (ordersNav) {
        ordersNav.addEventListener('click', function() {
          requestNotificationPermission();
        });
      }
    }
  }
}

function setupRealTimeNotifications() {
    console.log('🔔 Setting up real-time notifications...');
    
    // Add safety check - don't crash if currentCompany is null
    if (!currentCompany || !currentCompany.id) {
        console.log('⚠️ No company data yet, skipping real-time setup');
        return;
    }
    
    console.log('✅ Setting up real-time for company:', currentCompany.id);
    
    // Load notification sound
    notificationSound = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==');
    
    // Setup real-time subscription for orders
    orderSubscription = supabase
        .channel('orders-realtime')
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'orders',
                filter: `company_id=eq.${currentCompany.id}`
            },
            (payload) => {
                console.log('🆕 New order received:', payload);
                handleNewOrder(payload.new);
            }
        )
        .subscribe((status) => {
            console.log('📡 Real-time subscription status:', status);
        });
    
    // Setup browser notifications
    setupBrowserNotifications();
    
    // Update sound indicator
    updateSoundIndicator();
}

// Request browser notification permission
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        showToast('Browser notifications enabled!', 'success');
      }
    });
  }
}

function openMealModal(mode = 'new', mealData = null) {
  const modal = document.getElementById('mealModal');
  const form = document.getElementById('mealForm');
  const titleEl = document.getElementById('mealFormTitle');
  const submitBtn = document.getElementById('submitMealBtn');

  if (!modal || !form || !titleEl) {
    console.error('❌ Meal modal elements noasync function loadCategories() {t found');
    return;
  }

  form.reset();
  document.getElementById('mealId').value = '';

  if (mode === 'edit' && mealData) {
    titleEl.textContent = 'Edit Meal';
    submitBtn.textContent = 'Update Meal';
    document.getElementById('mealId').value = mealData.id;
    document.getElementById('mealName').value = mealData.name;
    document.getElementById('mealPrice').value = mealData.price;
    document.getElementById('mealDescription').value = mealData.description || '';
    document.getElementById('mealCategory').value = mealData.category || '';
    document.getElementById('mealForm').dataset.existingImage = mealData.image_url || "";
  } else {
    titleEl.textContent = 'Add New Meal';
    submitBtn.textContent = 'Save Meal';
  }

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

// Show browser notification
function showBrowserNotification(order) {
  if ('Notification' in window && Notification.permission === 'granted') {
    const notification = new Notification('New Order Received!', {
      body: `Order #${order.id.slice(-8)} from ${order.customer_name || 'Customer'}`,
      icon: 'https://i.ibb.co/3Jh3Wzb/Artboard-1-copy-2.png',
      tag: 'new-order'
    });
    
    notification.onclick = function() {
      window.focus();
      showSection('orders');
      this.close();
    };
    
    // Auto close after 5 seconds
    setTimeout(() => notification.close(), 5000);
  }
}

// Show in-app notification
function showInAppNotification(order) {
  const notification = document.createElement('div');
  notification.className = 'in-app-notification';
  notification.innerHTML = `
    <div class="notification-content">
      <div class="notification-icon">🆕</div>
      <div class="notification-text">
        <strong>New Order Received</strong>
        <p>Order #${order.id.slice(-8)} from ${order.customer_name || 'Customer'}</p>
        <small>${new Date().toLocaleTimeString()}</small>
      </div>
      <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
    </div>
  `;
  
  const notificationsContainer = document.getElementById('notificationsContainer');
  if (!notificationsContainer) {
    const container = document.createElement('div');
    container.id = 'notificationsContainer';
    container.className = 'notifications-container';
    document.body.appendChild(container);
  }
  
  document.getElementById('notificationsContainer').appendChild(notification);
  
  // Auto remove after 8 seconds
  setTimeout(() => {
    if (notification.parentElement) {
      notification.remove();
    }
  }, 8000);
}

// Mark orders as seen
function markOrdersAsSeen() {
  unreadOrdersCount = 0;
  updateNotificationBadges();
  showToast('All orders marked as read', 'success');
}

// Cleanup real-time subscriptions
function cleanupRealTimeSubscriptions() {
    if (orderSubscription) {
        supabase.removeChannel(orderSubscription);
        orderSubscription = null;
    }
}

async function loadCategories() {
  const categorySelect = document.getElementById("mealCategory");
  if (!categorySelect) return;

  // Example: categories table
  const { data, error } = await supabase.from("categories").select("*");

  if (error || !data || data.length === 0) {
    categorySelect.innerHTML = `
      <option value="Main Course">Main Course</option>
      <option value="Fast Food">Fast Food</option>
      <option value="Drinks">Drinks</option>
      <option value="Snacks">Snacks</option>
      <option value="Desserts">Desserts</option>
    `;
    return;
  }

  categorySelect.innerHTML = data
    .map(cat => `<option value="${cat.name}">${cat.name}</option>`)
    .join("");
}

// Enhanced logout function with custom confirmation
async function handleLogout() {
    try {
        console.log('🔴 Starting logout process...');

        // Show custom confirmation instead of browser confirm
        showConfirmModal(
            'Are you sure you want to log out?', 
            async () => {
                console.log('✅ User confirmed logout');
                
                showLoading('Logging out...');
                
                // Cleanup real-time subscriptions
                cleanupRealTimeSubscriptions();
                
                // Sign out from Supabase
                const { error } = await supabase.auth.signOut();
                if (error) {
                    console.error('❌ Supabase logout error:', error);
                    throw error;
                }
                
                // Clear all local state and storage
                currentUser = null;
                currentCompany = null;
                localStorage.removeItem('supabase.auth.token');
                localStorage.removeItem('currentUser');
                localStorage.removeItem('currentCompany');
                sessionStorage.clear();
                
                console.log('✅ Logout successful');
                
                // Show success message
                showToast('Logged out successfully!', 'success');
                
                // Small delay to show toast, then show login screen
                setTimeout(() => {
                    hideLoading();
                    showLoginScreen();
                }, 1500);
            }
        );
        
    } catch (error) {
        console.error('🔴 Logout failed:', error);
        hideLoading();
        
        // Force logout even if API fails
        localStorage.clear();
        sessionStorage.clear();
        currentUser = null;
        currentCompany = null;
        
        showToast('Logged out successfully!', 'success');
        
        // Still show login screen
        setTimeout(() => {
            showLoginScreen();
        }, 1000);
    }
}

function prevStep() {
    console.log('⬅️ Previous step clicked, current step:', currentStep);
    
    if (currentStep > 1) {
        currentStep--;
        updateStepUI();
        console.log('✅ Moved to step:', currentStep);
    }
}

// Enhanced step UI update
function updateStepUI() {
    console.log('🔄 Updating step UI to step:', currentStep);
    
    // Hide all form sections
    document.querySelectorAll('.form-section').forEach(section => {
        section.style.display = 'none';
    });
    
    // Show current step
    const currentSection = document.querySelector(`.form-section[data-step="${currentStep}"]`);
    if (currentSection) {
        currentSection.style.display = 'block';
        console.log('✅ Showing section:', currentSection.id);
    }
    
    // Update progress bars
    const progressFill = document.getElementById('progressFill');
    const progressFill2 = document.getElementById('progressFill2');
    
    if (progressFill) {
        progressFill.style.width = `${(currentStep / 2) * 100}%`;
    }
    if (progressFill2) {
        progressFill2.style.width = `${(currentStep / 2) * 100}%`;
    }
    
    // Update step indicators
    document.querySelectorAll('.step-indicator .step').forEach(step => {
        const stepNum = parseInt(step.getAttribute('data-step'));
        step.classList.remove('active', 'completed');
        
        if (stepNum === currentStep) {
            step.classList.add('active');
        } else if (stepNum < currentStep) {
            step.classList.add('completed');
        }
    });
}

async function checkBackendHealth() {
    try {
        const response = await fetch('/api/health');
        return response.ok;
    } catch (error) {
        return false;
    }
}

// ADD THIS FUNCTION - Confirm Modal Setup
function setupConfirmModalListeners() {
    const confirmModal = document.getElementById('confirmModal');
    const confirmNo = document.getElementById('confirmNo');
    const confirmYes = document.getElementById('confirmYes');
    const closeConfirmModal = document.getElementById('closeConfirmModal');
    
    console.log('🔧 Setting up confirm modal listeners...');
    
    // Click outside to close
    if (confirmModal) {
        confirmModal.addEventListener('click', function(e) {
            if (e.target === confirmModal) {
                hideConfirmModal();
            }
        });
    }
    
    // Cancel button
    if (confirmNo) {
        confirmNo.addEventListener('click', hideConfirmModal);
        console.log('✅ Confirm No button listener added');
    }
    
    // Close button (X)
    if (closeConfirmModal) {
        closeConfirmModal.addEventListener('click', hideConfirmModal);
        console.log('✅ Close confirm modal listener added');
    }
    
    // Confirm button
    if (confirmYes) {
        confirmYes.addEventListener('click', function() {
            console.log('✅ Confirm Yes button clicked');
            executePendingAction();
        });
        console.log('✅ Confirm Yes button listener added');
    }
}

function setupLogoutButton() {
    console.log('🔧 Setting up logout button (delegated).');

    // remove any inline listener duplicates first (attempt)
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        try { logoutBtn.replaceWith(logoutBtn.cloneNode(true)); } catch (_) {}
    }

    // Delegated listener (will work even if node replaced later)
    document.removeEventListener('click', __logoutDelegatedHandler);
    document.addEventListener('click', __logoutDelegatedHandler);

    console.log('✅ Logout delegation attached');
}

function __logoutDelegatedHandler(event) {
    const btn = event.target.closest('#logoutBtn');
    if (!btn) return;

    console.log("🚪 Logout button clicked");

    event.preventDefault();

    // 🔥 Instead of calling handleLogout directly, set the pending action
    window.pendingAction = handleLogoutConfirmed;

    // 🔥 Open your global confirmation modal
    openModal('confirmModal');
}

async function handleLogoutConfirmed() {
    try {
        console.log('🔴 Logging out...');

        showLoading('Logging out...');

        const { error } = await supabase.auth.signOut();
        if (error) {
            console.error('❌ Supabase logout error:', error);
            throw error;
        }

        // Clear state
        currentUser = null;
        currentCompany = null;
        localStorage.clear();
        sessionStorage.clear();

        console.log('✅ Logout successful');
        showToast('Logged out successfully!', 'success');

        setTimeout(() => {
            hideLoading();
            showLoginScreen();
        }, 800);

    } catch (err) {
        console.error('❌ Logout failed:', err);

        localStorage.clear();
        sessionStorage.clear();

        showToast('Logged out!', 'success');
        showLoginScreen();
    }
}

async function handleSubscriptionSubmit(e) {
    console.log("🔥 handleSubscriptionSubmit() FIRED");

    const email = document.getElementById("email").value.trim();
    const companyId = currentCompany?.id;
    const userId = currentUser?.id;

    if (!email || !companyId || !userId) {
        showToast("Missing required subscription info", "error");
        return;
    }

    try {
        showLoading("Starting free trial...");

        const res = await fetch(`${window.location.origin.replace(/:3000$/, ':5000')}/api/paystack/initialize-subscription`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email,
    business_id: companyId,
    user_id: userId
  })
});

        const json = await res.json();

        if (!json.success) {
            showToast(json.error || "Subscription failed", "error");
            return;
        }

        window.location.href = json.authorization_url;

    } catch (err) {
        console.error("❌ Subscription error:", err);
        showToast("Network error", "error");
    } finally {
        hideLoading();
    }
}

// Add this near initializeApplication or DOMContentLoaded
const startBtn = document.getElementById('startFreeTrialBtn');
if (startBtn) {
  startBtn.removeEventListener('click', openSubscriptionModal);
  startBtn.addEventListener('click', (e) => {
    e.preventDefault();
    console.log('🎯 Start Free Trial clicked');
    openSubscriptionModal();
  });
}

function initializeApplication() {
    console.log('🚀 Initializing Restaurant Admin Application');

    if (window.appInitialized) return;
    window.appInitialized = true;

    setupNavigationListeners();
    setupMobileNavigation();
    setupLoginHandler();
    setupRegistrationFlow();
    setupPasswordResetListeners();
    setupModalOverlayListeners();
    setupConfirmModalListeners();
    setupCustomConfirmModal();
    setupMealForm();
    setupLogoutButton();
    setupSubscriptionModal();

    checkAuthState();

    console.log('✅ Application initialized successfully');
}

function debugMealListeners() {
    console.log('🔍 DEBUG: Checking meal listeners...');
    
    // Check how many event listeners exist
    const editButtons = document.querySelectorAll('.meal-edit-btn');
    const deleteButtons = document.querySelectorAll('.meal-delete-btn');
    
    console.log(`Edit buttons: ${editButtons.length}`);
    console.log(`Delete buttons: ${deleteButtons.length}`);
    console.log(`Delegation setup: ${mealDelegationSetup}`);
    
    // Test if delegation is working
    console.log('🎯 Testing delegation - try clicking edit/delete buttons');
}

// Emergency modal debug and close function
function emergencyModalFix() {
    console.log('🚨 EMERGENCY MODAL FIX');
    
    // Close all modals
    const modals = document.querySelectorAll('.modal-overlay');
    let closedCount = 0;
    
    modals.forEach(modal => {
        if (!modal.classList.contains('hidden')) {
            modal.classList.add('hidden');
            modal.style.display = 'none';
            closedCount++;
        }
    });
    
    // Reset body styles
    document.body.style.overflow = 'auto';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.classList.remove('modal-open');
    
    // Remove any backdrops
    const backdrops = document.querySelectorAll('.modal-backdrop');
    backdrops.forEach(backdrop => backdrop.remove());
    
    console.log(`✅ Closed ${closedCount} modals, reset body styles`);
    showToast('Emergency modal fix applied', 'info');
}

// Make it available globally
window.emergencyModalFix = emergencyModalFix;

// Debug function for navigation issues
function debugNavigation() {
    console.log('🧭 NAVIGATION DEBUG:');
    
    // Check if nav items exist
    const navItems = document.querySelectorAll('.nav-item');
    console.log('1. Nav items found:', navItems.length);
    
    navItems.forEach((item, index) => {
        const section = item.getAttribute('data-section');
        const isActive = item.classList.contains('active');
        console.log(`   ${index + 1}. ${section} - Active: ${isActive}`);
    });
    
    // Check if sections exist
    const sections = ['dashboard', 'meals', 'orders', 'settings'];
    sections.forEach(section => {
        const sectionEl = document.getElementById(`${section}Section`);
        console.log(`2. ${section}Section exists:`, !!sectionEl);
        console.log(`3. ${section}Section active:`, sectionEl?.classList.contains('active'));
        console.log(`4. ${section}Section display:`, sectionEl?.style.display);
    });
    
    // Check event listeners
    const firstNavItem = document.querySelector('.nav-item');
    if (firstNavItem) {
        console.log('5. First nav item onclick:', firstNavItem.onclick);
    }
    
    console.log('=== END NAVIGATION DEBUG ===');
}

// Make it available globally
window.debugNavigation = debugNavigation;

// Test function to verify all fixes
async function testAllFixes() {
    console.log('🧪 TESTING ALL FIXES');
    
    // Test 1: Registration form
    console.log('1. Testing registration form...');
    const regForm = document.getElementById('registrationForm');
    console.log('✅ Registration form:', !!regForm);
    
    // Test 2: WhatsApp settings
    console.log('2. Testing WhatsApp settings...');
    const whatsappFields = document.getElementById('settingsWhatsappFields');
    console.log('✅ WhatsApp fields:', !!whatsappFields);
    
    // Test 3: Support form
    console.log('3. Testing support form...');
    const supportForm = document.getElementById('supportForm');
    console.log('✅ Support form:', !!supportForm);
    
    // Test 4: Meal management
    console.log('4. Testing meal management...');
    const mealSearch = document.getElementById('mealSearch');
    console.log('✅ Meal search:', !!mealSearch);
    
    console.log('🎉 ALL TESTS COMPLETED');
}

// Run tests after page loads
setTimeout(testAllFixes, 2000);

// Add export listeners
function setupExportListeners() {
    const exportBtn = document.querySelector('[onclick="openExportModal()"]');
    if (exportBtn) {
        exportBtn.addEventListener('click', openExportModal);
        console.log('✅ Export button listener attached');
    }
}

// Single DOM ready handler
document.addEventListener('DOMContentLoaded', function() {
    console.log('📄 DOM fully loaded');
    let pendingDeleteMealId = null;

    
    // Small delay to ensure all elements are ready
    setTimeout(() => {
        initializeApplication();
    }, 100);
});

// Also initialize when window loads as backup
window.addEventListener('load', function() {
    console.log('🔄 Window loaded');
    if (!window.appInitialized) {
        setTimeout(() => {
            initializeApplication();
        }, 200);
    }
});

// Add this debug function to check your database schema
async function debugDatabaseSchema() {
    try {
        console.log('🔍 Checking database schema...');
        
        // Check companies table structure
        const { data: sampleCompany, error } = await supabase
            .from('companies')
            .select('*')
            .limit(1)
            .single();
            
        if (error) {
            console.error('❌ Cannot access companies table:', error);
            return;
        }
        
        console.log('✅ Companies table columns:', Object.keys(sampleCompany));
        
        // Check for WhatsApp columns
        const hasWhatsAppColumns = 
            'enable_whatsapp_notifications' in sampleCompany &&
            'whatsapp_number' in sampleCompany &&
            'whatsapp_message_template' in sampleCompany;
            
        console.log('📱 WhatsApp columns present:', hasWhatsAppColumns);
        
        if (!hasWhatsAppColumns) {
            console.log('❌ MISSING WHATSAPP COLUMNS - Run the SQL fix above');
            showToast(
                'Database missing WhatsApp columns. Please run the SQL migration.',
                'error'
            );
        }
        
    } catch (error) {
        console.error('❌ Schema debug failed:', error);
    }
}

async function debugSubscriptionTable() {
    try {
        console.log('🔍 Debugging subscription table...');
        
        // Test the subscription query with different field names
        const { data, error } = await supabase
  .from('subscriptions')
  .select('*')
  .eq('user_id', user.id)
  .in('status', ['active', 'trialing']);

        if (error) {
            console.error('❌ Subscription table error:', error);
            return null;
        }
        
        console.log('✅ Subscription table sample:', data);
        return data;
    } catch (error) {
        console.error('❌ Debug failed:', error);
        return null;
    }
}

function showLoadingState(show, message = 'Loading...') {
    const submitBtn = document.querySelector('#loginForm button[type="submit"]');
    if (submitBtn) {
        if (show) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = message;
        } else {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Sign In';
        }
    }
}

function getErrorMessage(error) {
    if (error.message) {
        return error.message;
    }
    return 'An unknown error occurred';
}

// ✅ CRITICAL FIX: Registration form submit handler
    const registrationForm = document.getElementById('registrationForm');
    if (registrationForm) {
        // Remove any existing listeners
        registrationForm.removeEventListener('submit', handleRegistration);
        console.log('✅ Registration form submit listener attached');
    }
    
    // WhatsApp toggle setup
    const enableWhatsAppCheckbox = document.getElementById('regEnableWhatsApp');
    if (enableWhatsAppCheckbox) {
        enableWhatsAppCheckbox.addEventListener('change', toggleWhatsAppFields);
        // Initialize on load
        setTimeout(toggleWhatsAppFields, 100);
    }
    
    console.log('✅ Registration flow setup complete');


function togglePasswordVisibility(passwordField) {
    if (!passwordField) return;
    const type = passwordField.type === 'password' ? 'text' : 'password';
    passwordField.type = type;
}

// Utility function to get current restaurant ID
function getCurrentRestaurantId() {
    const userData = JSON.parse(localStorage.getItem('currentUser'));
    return userData?.restaurant_id || userData?.id;
}

function setupEventListeners() {
    console.log('🔧 Setting up event listeners...');

    // Meal management
    setupMealSearch();
    setupImagePreview();

    // Navigation
    setupNavigationListeners();
    
    // Form submissions
    setupFormSubmissionListeners();

    // Company info
    setupCompanyInfoForm();

    // Test backend connection
    testBackendConnection();

    console.log('✅ All event listeners setup complete');
}

function setupImagePreview() {
    const mealImageInput = document.getElementById('mealImage');
    if (mealImageInput) {
        mealImageInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    const preview = document.getElementById('mealImagePreview');
                    if (preview) {
                        preview.innerHTML = `
                            <div class="current-image">
                                <p>New Image Preview:</p>
                                <img src="${e.target.result}" alt="New image preview" style="max-width: 200px; max-height: 150px; border-radius: 8px;">
                            </div>
                        `;
                        preview.style.display = 'block';
                    }
                };
                reader.readAsDataURL(file);
            }
        });
    }
}

// FIX PASSWORD RESET
document.getElementById('passwordResetForm').addEventListener('submit', async function(e) {
e.preventDefault();
    
    const email = document.getElementById('resetEmail').value;
    
    if (!email) {
        showToast('Please enter your email address', 'error');
        return;
    }
    
    try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/reset-password.html'
        });

        if (error) throw error;

        showToast('Password reset link sent to your email!', 'success');
        hidePasswordResetModal();
        
    } catch (error) {
        console.error('Password reset error:', error);
        showToast('Error: ' + error.message, 'error');
    }
});

function toggleWhatsAppField() {
    const enableWhatsApp = document.getElementById('enableWhatsApp');
    const whatsappField = document.getElementById('whatsappField');
    if (enableWhatsApp.checked) {
        whatsappField.classList.remove('hidden');
    } else {
        whatsappField.classList.add('hidden');
    }
}

// Replace your current navigation setup with this:
function setupNavigationListeners() {
    console.log('🔧 Setting up navigation listeners...');
    
    // Desktop navigation - Use event delegation for better reliability
    document.addEventListener('click', function(e) {
        // Check if clicked element is a nav item or inside one
        const navItem = e.target.closest('.nav-item');
        if (navItem && !navItem.classList.contains('active')) {
            const section = navItem.getAttribute('data-section');
            console.log('📱 Desktop nav clicked:', section);
            showSection(section);
        }
        
        // Check mobile nav items too
        const mobileNavItem = e.target.closest('.mobile-nav-item');
        if (mobileNavItem) {
            const section = mobileNavItem.getAttribute('data-section');
            console.log('📱 Mobile nav clicked:', section);
            showSection(section);
            closeMobileNav();
        }
    });

    // Also set up direct event listeners as backup
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        // Remove existing listeners
        const newItem = item.cloneNode(true);
        item.parentNode.replaceChild(newItem, item);
        
        // Add fresh listener
        newItem.addEventListener('click', function() {
            const section = this.getAttribute('data-section');
            console.log('📱 Direct nav click:', section);
            showSection(section);
        });
    });

    console.log('✅ Navigation listeners setup complete');
}

function setupFormSubmissionListeners() {
    const mealForm = document.getElementById('mealForm');
    if (mealForm) {
        try {
            if (typeof handleMealSubmit === 'function') {
                mealForm.removeEventListener('submit', handleMealSubmit);
            }
        } catch (err) {
            console.warn('Could not remove previous meal submit listener (may be undefined)', err);
        }
         mealForm.addEventListener('submit', function(e) {
            e.preventDefault();
            console.log('🎯 Meal form submit (safe wrapper) triggered');
            if (typeof handleMealSubmit === 'function') {
                try { handleMealSubmit(e); } catch (err) { console.error('handleMealSubmit threw:', err); }
            } else {
                console.error('handleMealSubmit is not defined yet. Please ensure its definition appears before setupMealForm() or paste the function in the file.');
                showToast('Internal error: meal handler missing', 'error');
            }
        });
        console.log('✅ Meal form submit listener attached (safe wrapper)');
    }
}

async function testBackendConnection() {
    try {
        console.log('🔍 Testing backend connection...');
        
        // Test basic backend connectivity
        const testResponse = await fetch('http://localhost:5000/api/health');
        console.log('Backend health check:', testResponse.status, testResponse.statusText);
        
        if (testResponse.ok) {
            const testData = await testResponse.json();
            console.log('✅ Backend is working:', testData);
            return true;
        } else {
            console.error('❌ Backend health check failed:', testResponse.status);
            return false;
        }
    } catch (error) {
        console.error('❌ Cannot reach backend:', error.message);
        console.error('💡 Make sure your backend server is running on localhost:5000');
        return false;
    }
}

// ===== Lightweight showToast fallback =====
function showToast(message, type = 'info', opts = {}) {
  try {
    // If you already have your own UI toasts, this will be a no-op since
    // your real showToast will override this function by name.
    const containerId = 'appToastContainer';
    let container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      container.style.position = 'fixed';
      container.style.right = '20px';
      container.style.bottom = '20px';
      container.style.zIndex = 9999;
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    el.style.marginTop = '8px';
    el.style.padding = '10px 14px';
    el.style.borderRadius = '6px';
    el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
    el.style.background = (type === 'error' ? '#ffdddd' : (type === 'success' ? '#ddffdd' : '#ffffff'));
    container.appendChild(el);
    setTimeout(() => el.remove(), opts.duration || 3500);
  } catch (err) {
    try { console.log(`[${type}] ${message}`); } catch (e) {}
  }
}

// ===== Safe company result handler =====
// Usage: pass { data: company, error } from supabase query
function handleCompanyQueryResult(result) {
  // result expected: { data: companyOrNull, error: errorObjOrNull }
  const company = result?.data ?? null;
  const error = result?.error ?? null;

  if (error) {
    // PGRST116 = no rows found (not an error we need to crash on)
    if (error?.code === "PGRST116") {
      console.warn("⚠️ No company rows found for user (PGRST116).");
      window.currentCompany = null;
      localStorage.removeItem("currentCompany");
      return false;
    }
    console.error("❌ checkAuthState company load error:", error);
    showToast && showToast("Unable to load company", "error");
    return false;
  }

  if (!company) {
    console.warn("⚠️ No company record found for user.");
    window.currentCompany = null;
    localStorage.removeItem("currentCompany");
    return false;
  }

  // success: set global currentCompany
  window.currentCompany = company;
  localStorage.setItem("currentCompany", JSON.stringify(company));
  console.log("🏢 Loaded company:", company);
  return true;
}

// Real-time subscription for meals
function setupMealsRealtime() {
    if (!currentCompany) return;
    
    const subscription = supabase
        .channel('meals-changes')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'meals',
                filter: `company_id=eq.${currentCompany.id}`
            },
            (payload) => {
                console.log('Meal change received:', payload);
                loadMeals(); // Refresh meals list
            }
        )
        .subscribe();
    
    return subscription;
}

// Update the showSection function to setup real-time
function showSection(sectionName) {
    // ... existing code ...
    
     if (sectionName === 'meals') {
        setTimeout(() => {
            setupMealsRealtime();
        }, 1000);
    }

    if (sectionName !== 'dashboard') {
        const recentActivity = document.getElementById('recentActivity');
        const statsGrid = document.querySelector('.stats-grid');
        if (recentActivity) recentActivity.style.display = 'none';
        if (statsGrid) statsGrid.style.display = 'none';
    } else {
        const recentActivity = document.getElementById('recentActivity');
        const statsGrid = document.querySelector('.stats-grid');
        if (recentActivity) recentActivity.style.display = 'block';
        if (statsGrid) statsGrid.style.display = 'grid';
    }
}

function setupModalCloseListeners() {
    const confirmModal = document.getElementById('confirmModal');
    const confirmNo = document.getElementById('confirmNo');
    const confirmYes = document.getElementById('confirmYes');
    const closeConfirmModal = document.getElementById('closeConfirmModal');
    
    if (confirmModal) {
        confirmModal.addEventListener('click', function(e) {
            if (e.target === confirmModal) hideConfirmModal();
        });
    }
    
    if (confirmNo) confirmNo.addEventListener('click', hideConfirmModal);
    if (closeConfirmModal) closeConfirmModal.addEventListener('click', hideConfirmModal);
    if (confirmYes) confirmYes.addEventListener('click', executePendingAction);
}

function showConfirmModal(message, action) {
    const confirmModal = document.getElementById('confirmModal');
    const confirmMessage = document.getElementById('confirmMessage');
    
    if (confirmModal && confirmMessage) {
        confirmMessage.textContent = message;
        pendingAction = action;
        confirmModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        console.log('✅ Confirm modal shown with message:', message);
    } else {
        console.error('❌ Confirm modal elements not found');
        // Fallback to browser confirm
        if (confirm(message)) {
            action();
        }
    }
}

function showRegisterModal() {
    console.log('📝 Opening register modal...');
    const registerModal = document.getElementById('registerModal');
    if (registerModal) {
        registerModal.classList.remove('hidden');
        // FIX: Remove aria-hidden to prevent accessibility conflicts
        registerModal.removeAttribute('aria-hidden');
        document.body.style.overflow = 'hidden';
        resetRegistrationForm(); // Reset form state
    }
}

// Hide register modal
function hideRegisterModal() {
    const registerModal = document.getElementById('registerModal');
    if (registerModal) {
        registerModal.classList.add('hidden');
        // FIX: Add aria-hidden when hidden
        registerModal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        resetRegistrationForm();
    }
}

function hideConfirmModal() {
    const confirmModal = document.getElementById('confirmModal');
    if (confirmModal) {
        confirmModal.classList.add('hidden');
        document.body.style.overflow = '';
        pendingAction = null;
        console.log('✅ Confirm modal hidden');
    }
}

function executePendingAction() {
    console.log("🔄 Executing pending action...");

    if (typeof window.pendingAction === "function") {
        window.pendingAction();
        window.pendingAction = null;
        window.pendingDeleteMealId = null;
    } else {
        console.error("❌ No valid pending action");
    }

    closeModal('confirmModal');
}


// Enhanced validation functions
function validateStep1() {
    console.log('🔍 Validating step 1...');
    
    const email = document.getElementById('regEmail')?.value.trim();
    const password = document.getElementById('regPassword')?.value;
    const confirmPassword = document.getElementById('regConfirmPassword')?.value;
    const username = document.getElementById('regUsername')?.value.trim();
    
    clearFieldErrors();
    
    let isValid = true;
    
    // Required field validation
    if (!username) {
        showFieldError('regUsername', 'Username is required');
        isValid = false;
    } else if (username.length < 3) {
        showFieldError('regUsername', 'Username must be at least 3 characters');
        isValid = false;
    }
    
    if (!email) {
        showFieldError('regEmail', 'Email is required');
        isValid = false;
    } else {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            showFieldError('regEmail', 'Please enter a valid email address');
            isValid = false;
        }
    }
    
    if (!password) {
        showFieldError('regPassword', 'Password is required');
        isValid = false;
    } else if (password.length < 6) {
        showFieldError('regPassword', 'Password must be at least 6 characters');
        isValid = false;
    }
    
    if (!confirmPassword) {
        showFieldError('regConfirmPassword', 'Please confirm your password');
        isValid = false;
    } else if (password !== confirmPassword) {
        showFieldError('regConfirmPassword', 'Passwords do not match');
        isValid = false;
    }
    
    console.log('✅ Step 1 validation result:', isValid);
    return isValid;
}

// Debug version of validateStep2
function validateStep2() {
    console.log('🔍 Validating step 2...');
    
    const companyName = document.getElementById('regCompanyName')?.value.trim();
    const companyAddress = document.getElementById('regCompanyAddress')?.value.trim();
    const companyPhone = document.getElementById('regCompanyPhone')?.value.trim();
    
    console.log('📋 Step 2 Data:', {
        companyName: companyName,
        companyAddress: companyAddress,
        companyPhone: companyPhone
    });
    
    clearFieldErrors();
    
    let isValid = true;
    
    // Company Name validation
    if (!companyName) {
        console.log('❌ Company name is empty');
        showFieldError('regCompanyName', 'Restaurant name is required');
        isValid = false;
    } else {
        console.log('✅ Company name is valid');
    }
    
    // Address validation
    if (!companyAddress) {
        console.log('❌ Company address is empty');
        showFieldError('regCompanyAddress', 'Address is required');
        isValid = false;
    } else {
        console.log('✅ Company address is valid');
    }
    
    // Phone validation
    if (!companyPhone) {
        console.log('❌ Company phone is empty');
        showFieldError('regCompanyPhone', 'Phone number is required');
        isValid = false;
    } else {
        const phoneValid = isValidPhone(companyPhone);
        console.log('📞 Phone validation result:', phoneValid);
        
        if (!phoneValid) {
            showFieldError('regCompanyPhone', 'Please enter a valid phone number (at least 10 digits)');
            isValid = false;
        } else {
            console.log('✅ Company phone is valid');
        }
    }
    
    console.log('✅ Step 2 validation result:', isValid);
    return isValid;
}

// Enhanced field error display
function showFieldError(fieldId, message) {
    const field = document.getElementById(fieldId);
    if (field) {
        // Remove existing error
        const existingError = field.parentNode.querySelector('.field-error');
        if (existingError) {
            existingError.remove();
        }
        
        // Add error class to field
        field.classList.add('error');
        
        // Create error message
        const errorElement = document.createElement('div');
        errorElement.className = 'field-error';
        errorElement.textContent = message;
        errorElement.style.color = '#e74c3c';
        errorElement.style.fontSize = '0.875rem';
        errorElement.style.marginTop = '0.25rem';
        
        field.parentNode.appendChild(errorElement);
    }
}

// Enhanced clear field errors
function clearFieldErrors() {
    document.querySelectorAll('.field-error').forEach(error => error.remove());
    document.querySelectorAll('.input-group input.error, .input-group textarea.error').forEach(field => {
        field.classList.remove('error');
    });
}

function isValidPhone(phone) {
    const phoneRegex = /^[\+]?[0-9\s\-\(\)]{10,}$/;
    return phoneRegex.test(phone);
}

function clearFieldError(fieldId) {
    const field = document.getElementById(fieldId);
    if (field) {
        field.classList.remove('error');
        const errorElement = field.parentNode.querySelector('.field-error');
        if (errorElement) {
            errorElement.remove();
        }
    }
}

function resetRegistrationForm() {
    console.log('🔄 Resetting registration form');
    
    const form = document.getElementById('registrationForm');
    if (form) {
        form.reset();
    }
    
    clearFieldErrors();
    
    const errorElement = document.getElementById('registerError');
    if (errorElement) {
        errorElement.textContent = '';
        errorElement.style.display = 'none';
    }
    
    // Reset WhatsApp toggle
    const enableWhatsApp = document.getElementById('regEnableWhatsApp');
    if (enableWhatsApp) {
        enableWhatsApp.checked = true;
        toggleWhatsAppFields();
    }
    
    console.log('✅ Registration form reset');
}

// ============================
// FIXED AUTH STATE MANAGEMENT
// ============================
async function checkAuthState() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user) {
            console.log('✅ USER LOGGED IN:', session.user.email);
            currentUser = session.user;
            
            // Load company data BEFORE showing dashboard
            const companyLoaded = await loadUserData(session.user);
            if (companyLoaded) {
    showDashboard();

    // 🔥 Initialize meal system once user is fully logged in
    setupMealDelegation();
    setupMealForm();

    // Load all dashboard data
    setTimeout(() => {
        loadDashboardData();
        loadMeals();  // meals now load correctly because delegation + form are ready
        loadSubscriptionData().catch(err => console.log('Subscription load optional'));
    }, 100);

} else {
    console.error('❌ Failed to load company data');
    showToast('Error loading restaurant data', 'error');
}

            
        } else {
            console.log('🔴 NO ACTIVE SESSION');
            showLoginScreen();
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        showLoginScreen();
    }
}

async function debugSession() {
    console.log('🔍 DEBUG SESSION INFO:');
    console.log('Current User:', currentUser);
    
    const { data: { session } } = await supabase.auth.getSession();
    console.log('Supabase Session:', session);
    console.log('Session Valid:', session?.user ? 'Yes' : 'No');
    
    const token = localStorage.getItem('supabase.auth.token');
    console.log('Token in localStorage:', token ? 'Exists' : 'Missing');
}

function generateQRCodeForCompany() {
    if (!currentCompany || !currentCompany.id) {
        console.error("❌ currentCompany missing in generateQRCodeForCompany");
        return;
    }

    const menuUrl = `${window.location.origin}/menu.html?company=${currentCompany.id}`;
    const container = document.getElementById("qrCodeContainer");

    container.innerHTML = "";

    const qr = new QRCode(container, {
        text: menuUrl,
        width: 240,
        height: 240,
        correctLevel: QRCode.CorrectLevel.H
    });

    setTimeout(() => {
        const img = container.querySelector("img");
        if (!img) return;

        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");

        const temp = new Image();
        temp.crossOrigin = "Anonymous";
        temp.src = img.src;

        temp.onload = () => {
            ctx.drawImage(temp, 0, 0);
            container.innerHTML = "";
            canvas.id = "qrCanvas";
            container.appendChild(canvas);

            const downloadBtn = document.getElementById("downloadQRBtn");
            downloadBtn.disabled = false;
            downloadBtn.dataset.qr = canvas.toDataURL("image/png");

            const urlEl = document.getElementById("qrUrl");
            if (urlEl) {
                urlEl.href = menuUrl;
                urlEl.textContent = menuUrl;
            }
        };
    }, 300);
}

// Debug function to test registration
function debugRegistrationForm() {
    console.log('=== REGISTRATION FORM DEBUG ===');
    
    // Check if form exists
    const form = document.getElementById('registrationForm');
    console.log('1. Registration form exists:', !!form);
    
    // Check step sections
    const step1 = document.getElementById('registerStep1Form');
    const step2 = document.getElementById('registerStep2Form');
    console.log('2. Step 1 form exists:', !!step1);
    console.log('3. Step 2 form exists:', !!step2);
    
    // Check current step
    console.log('4. Current step:', currentStep);
    
    // Check event listeners
    if (form) {
        console.log('5. Form onsubmit:', form.onsubmit);
    }
    
    // Check WhatsApp toggle
    const whatsappToggle = document.getElementById('regEnableWhatsApp');
    const whatsappFields = document.getElementById('whatsappFields');
    console.log('6. WhatsApp toggle exists:', !!whatsappToggle);
    console.log('7. WhatsApp fields exists:', !!whatsappFields);
    console.log('8. WhatsApp toggle checked:', whatsappToggle?.checked);
    console.log('9. WhatsApp fields visible:', whatsappFields?.style.display !== 'none');
    
    console.log('=== END DEBUG ===');
}

// Loading state utility functions
function showLoading(message = 'Loading...') {
    // Remove existing loading overlay if any
    hideLoading();
    
    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'loading-overlay';
    loadingOverlay.id = 'globalLoading';
    loadingOverlay.innerHTML = `
        <div class="loading-content">
            <div class="loading-spinner"></div>
            <div class="loading-text">${message}</div>
        </div>
    `;
    
    document.body.appendChild(loadingOverlay);
}

function hideLoading() {
    const loadingOverlay = document.getElementById('globalLoading');
    if (loadingOverlay) {
        loadingOverlay.remove();
    }
}

// Run test after page loads
setTimeout(() => {
    testLoginFix();
}, 1000);

// Enhanced phone validation - more flexible
function isValidPhone(phone) {
    if (!phone || typeof phone !== 'string') return false;
    
    // Remove all non-digit characters
    const digitsOnly = phone.replace(/\D/g, '');
    
    // Basic validation: at least 10 digits
    return digitsOnly.length >= 10;
}

// Add a new meal input row (clones the last row)
function addMealRow() {
  const container = document.getElementById('multiMealContainer');
  if (!container) return console.warn('multiMealContainer not found');

  // clone last row and clear inputs
  const last = container.querySelector('.meal-entry:last-of-type');
  const clone = last.cloneNode(true);

  // increment data-row-index
  const newIndex = (parseInt(last.dataset.rowIndex || '0') + 1);
  clone.dataset.rowIndex = newIndex;

  // clear values
  clone.querySelectorAll('input, textarea').forEach(inp => {
    if (inp.type === 'file') inp.value = ''; else inp.value = '';
  });

  // show remove button on cloned rows
  const removeBtn = clone.querySelector('.remove-meal-row-btn');
  if (removeBtn) removeBtn.style.display = 'inline-block';

  container.appendChild(clone);
}

// Remove a meal input row (button passes itself as this)
function removeMealRow(btnOrEl) {
  // btnOrEl may be the button node because called from inline onclick
  const btn = (btnOrEl instanceof Element) ? btnOrEl : document.querySelector(btnOrEl);
  if (!btn) return;
  const entry = btn.closest('.meal-entry');
  if (!entry) return;
  const container = document.getElementById('multiMealContainer');
  // don't remove if it's the only row
  if (container.querySelectorAll('.meal-entry').length <= 1) {
    // reset values instead
    entry.querySelectorAll('input, textarea').forEach(i => i.value = '');
    return;
  }
  entry.remove();
}

async function handleMealFormSubmit(event) {
  event.preventDefault();
  // Basic guard
  if (!window.supabase) {
    console.error('Supabase client not found');
    return alert('Internal error: DB client missing');
  }

  const container = document.getElementById('multiMealContainer');
  if (!container) return alert('Form container missing');

  // Gather all rows into array
  const rows = Array.from(container.querySelectorAll('.meal-entry'));
  const mealsToInsert = [];

  for (const r of rows) {
    // collect inputs inside this row
    const name = (r.querySelector('.meal-name')?.value || '').trim();
    const priceRaw = (r.querySelector('.meal-price')?.value || '').trim();
    const price = priceRaw === '' ? null : Number(priceRaw);
    const description = (r.querySelector('.meal-desc')?.value || '').trim();
    const imageInput = r.querySelector('.meal-image');

    // skip empty rows (no name and no price)
    if (!name && (price === null || isNaN(price))) {
      continue;
    }

    // Validation per-row
    if (!name) return alert('Meal name is required for every filled row');
    if (price === null || isNaN(price)) return alert('Valid price is required for every filled row');

    // Build rowData - include fields your DB expects
    const rowData = {
      name,
      price,
      description,
      // If you handle image uploads, you must upload first (see note below)
      image_url: null,
      available: true,
      created_at: new Date().toISOString()
    };

    // If your system keeps company_id on each meal:
    if (window.currentCompany && currentCompany.id) rowData.company_id = currentCompany.id;

    mealsToInsert.push(rowData);
  }

  if (mealsToInsert.length === 0) {
    return alert('No meal rows to save. Fill at least one row.');
  }

  try {
    // Bulk insert all meals at once
    const { data, error } = await supabase
      .from('meals')
      .insert(mealsToInsert)
      .select();

    if (error) {
      console.error('Insert meals error', error);
      return alert('Failed to save meals: ' + (error.message || JSON.stringify(error)));
    }

    // success - refresh list and close modal
    console.log('Inserted meals:', data);
    await loadMeals(); // existing loader function in your script
    // close modal - adapt if you use a different function
    closeMealModal?.(); // optional: if you have a function to close the modal
    alert('Meals saved successfully');

  } catch (err) {
    console.error(err);
    alert('Unexpected error saving meals');
  }
}

// SAFE: attach Start Free Trial button handler even if modal not initialized earlier
(function ensureStartTrialListener() {
  const btn = document.getElementById('startFreeTrialBtn'); // change to your real ID
  if (!btn) return;
  // Remove existing listeners safely
  btn.replaceWith(btn.cloneNode(true));
  const newBtn = document.getElementById('startFreeTrialBtn');
  newBtn.addEventListener('click', (e) => {
    console.log('🎯 Start Free Trial (guaranteed handler) clicked');
    openSubscriptionModal();
  });
})();

function checkNetworkStatus() {
    if (!navigator.onLine) {
        console.error('❌ No internet connection');
        showToast('No internet connection', 'error');
        return false;
    }
    return true;
}

// ===== loadMealsForCompany shim =====
async function loadMealsForCompany(companyId) {
  console.log('🔁 loadMealsForCompany called for companyId:', companyId);
  // If existing loadMeals supports global currentCompany, set it and call
  if (companyId) {
    if (!window.currentCompany) window.currentCompany = {};
    window.currentCompany.id = companyId;
  }
  if (typeof loadMeals === 'function') {
    return await loadMeals();
  } else {
    console.error('❌ loadMeals() is not defined. Please provide a canonical loadMeals implementation.');
    return null;
  }
}
// ===== testLoginFix shim =====
function testLoginFix() {
  console.log('🔬 testLoginFix running quick checks.');

  // Check presence of functions / elements used by login/reg flows
  const checks = [
    { name: 'emergencyLogin', ok: typeof emergencyLogin === 'function' },
    { name: 'handleRegistration', ok: typeof handleRegistration === 'function' },
    { name: 'handleMealSubmit', ok: typeof handleMealSubmit === 'function' || typeof handleMealFormSubmit === 'function' },
    { name: 'registrationForm element', ok: !!document.getElementById('registrationForm') },
  ];

  checks.forEach(c => console.log(`${c.ok ? '✅' : '❌'} ${c.name}`));

  // If critical functions missing, log an actionable message
  if (!checks.find(c => c.name === 'emergencyLogin').ok) {
    console.warn('⚠️ emergencyLogin missing. Add its implementation or ensure it is loaded before calls.');
  }
}

async function loadMeals() {
    if (!currentCompany || !currentCompany.id) {
        console.error("❌ loadMeals: No company loaded.");
        return;
    }

    console.log("📥 Loading meals for company:", currentCompany.id);

    try {
        const { data: meals, error } = await supabase
            .from("meals")
            .select("*")
            .eq("company_id", currentCompany.id)
            .order("created_at", { ascending: false });

        if (error) throw error;

        console.log("🍽 Meals loaded:", meals);
        renderMeals(meals);
    } catch (err) {
        console.error("❌ loadMeals failed:", err);
    }
}


// ===== Canonical updateMeal =====
async function updateMeal(mealId, updatedData) {
  if (!mealId) {
    console.error("❌ updateMeal: No ID");
    return;
  }

  console.log("✏️ Updating meal:", mealId, updatedData);
  try {
    const { error } = await supabase
      .from('meals')
      .update(updatedData)
      .eq('id', mealId);

    if (error) {
      console.error("❌ Update failed:", error);
      showToast && showToast("Failed to update meal", "error");
      return;
    }

    showToast && showToast("Meal updated", "success");
    await loadMealsForCompany(currentCompany?.id);
  } catch (err) {
    console.error('❌ updateMeal caught error:', err);
    showToast && showToast('Error updating meal', 'error');
  }
}

// ===== Canonical deleteMeal =====
async function deleteMeal(mealId) {
  console.log("🔥 Deleting meal:", mealId);
  try {
    showLoading && showLoading('Deleting meal.');

    const { error } = await supabase
      .from("meals")
      .delete()
      .eq("id", mealId);

    if (error) {
      console.error("❌ Delete failed:", error);
      showToast && showToast("Failed to delete meal: " + (error.message || ''), "error");
      return;
    }

    console.log("✅ Meal deleted successfully");
    showToast && showToast("Meal deleted successfully!", "success");
    // Refresh
    setTimeout(loadMeals, 300);
  } catch (error) {
    console.error("❌ Error deleting meal:", error);
    showToast && showToast("Failed to delete meal: " + (error.message || ''), "error");
  } finally {
    hideLoading && hideLoading();
  }
}
// ===== Canonical setupMealMultiForm =====
function setupMealMultiForm() {
  const addBtn = document.getElementById('addMealRowBtn');
  if (addBtn) {
    addBtn.removeEventListener('click', addMealRow);
    addBtn.addEventListener('click', addMealRow);
  }

  const form = document.getElementById('mealForm');
  if (form) {
    try {
      form.removeEventListener('submit', handleMealFormSubmit);
    } catch (err) { /* ignore */ }
    form.addEventListener('submit', handleMealFormSubmit);
  }

  const first = document.querySelector('#multiMealContainer .meal-entry');
  if (first) {
    const rm = first.querySelector('.remove-meal-row-btn');
    if (rm) rm.style.display = 'none';
  }
}


function sortMealsWithFeatured(meals) {
  if (!meals || meals.length === 0) return [];
  
  const categoryPriority = {
    'Main Course': 1,
    'Main Dishes': 1,
    'Main': 1,
    'Entrees': 1,
    'Fast Food': 2,
    'Burgers': 2,
    'Pizza': 2,
    'Drinks': 3,
    'Beverages': 3,
    'Snacks': 4,
    'Sides': 4,
    'Appetizers': 4,
    'Desserts': 5,
    'Sweets': 5
  };
  
  return meals.sort((a, b) => {
    // Check if meals are featured (you can add a 'featured' boolean field to your meals table)
    const isFeaturedA = a.featured || false;
    const isFeaturedB = b.featured || false;
    
    // Featured meals always come first
    if (isFeaturedA && !isFeaturedB) return -1;
    if (!isFeaturedA && isFeaturedB) return 1;
    
    // Both featured or both not featured - sort by category priority
    const categoryA = (a.category || '').toLowerCase();
    const categoryB = (b.category || '').toLowerCase();
    
    let priorityA = 999;
    let priorityB = 999;
    
    Object.keys(categoryPriority).forEach(key => {
      if (categoryA === key.toLowerCase()) priorityA = categoryPriority[key];
      if (categoryB === key.toLowerCase()) priorityB = categoryPriority[key];
    });
    
    if (priorityA === 999 && categoryA.includes('main')) priorityA = 1;
    if (priorityB === 999 && categoryB.includes('main')) priorityB = 1;
    
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    
    // Same priority, sort by name
    return (a.name || '').localeCompare(b.name || '');
  });
}

function setupLoginHandler() {
  const loginForm = document.getElementById('loginForm');
  if (!loginForm) {
    console.warn('⚠️ loginForm not found — setupLoginHandler skipping.');
    return;
  }
  try { loginForm.removeEventListener('submit', handleLogin); } catch (e) {}
  loginForm.addEventListener('submit', handleLogin);
  console.log('✅ setupLoginHandler wired loginForm -> handleLogin');
}

function setupRegistrationFlow() {
  const showRegisterBtn = document.getElementById('showRegisterBtn');
  const registerForm = document.getElementById('registrationForm');
  const closeRegisterModal = document.getElementById('closeRegisterModal');
  const cancelRegisterBtn = document.getElementById('cancelRegisterBtn');

  if (showRegisterBtn && typeof showRegisterModal === 'function') {
    try { showRegisterBtn.removeEventListener('click', showRegisterModal); } catch (e) {}
    showRegisterBtn.addEventListener('click', showRegisterModal);
  }

  if (closeRegisterModal && typeof hideRegisterModal === 'function') {
    try { closeRegisterModal.removeEventListener('click', hideRegisterModal); } catch (e) {}
    closeRegisterModal.addEventListener('click', hideRegisterModal);
  }

  if (cancelRegisterBtn && typeof hideRegisterModal === 'function') {
    try { cancelRegisterBtn.removeEventListener('click', hideRegisterModal); } catch (e) {}
    cancelRegisterBtn.addEventListener('click', hideRegisterModal);
  }

  if (!registerForm) {
    console.warn('⚠️ registrationForm not found — setupRegistrationFlow skipping attach.');
    return;
  }

  // Remove old listener clones safely and attach our handler
  try {
    registerForm.removeEventListener('submit', handleRegistration);
  } catch (e) {}
  registerForm.addEventListener('submit', handleRegistration);
  console.log('✅ setupRegistrationFlow wired registrationForm -> handleRegistration');
}

function setupPasswordResetListenersSafe() {
  try {
    if (typeof setupPasswordResetListeners === 'function') {
      // existing implementation present — call it
      setupPasswordResetListeners();
      console.log('✅ Called existing setupPasswordResetListeners()');
      return;
    }
  } catch (e) {}
  // fallback wiring (in case original missing)
  const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
  if (forgotPasswordBtn && typeof showPasswordResetModal === 'function') {
    try { forgotPasswordBtn.removeEventListener('click', showPasswordResetModal); } catch (e) {}
    forgotPasswordBtn.addEventListener('click', showPasswordResetModal);
  }
  const passwordResetForm = document.getElementById('passwordResetForm');
  if (passwordResetForm && typeof handlePasswordReset === 'function') {
    try { passwordResetForm.removeEventListener('submit', handlePasswordReset); } catch (e) {}
    passwordResetForm.addEventListener('submit', handlePasswordReset);
  }
  console.log('✅ setupPasswordResetListenersSafe completed if fallback used');
}

async function confirmMealDelete(mealId) {
    if (!mealId) return;

    if (!confirm("Delete this meal?")) return;

    try {
        const { error } = await supabase
            .from("meals")
            .delete()
            .eq("id", mealId);

        if (error) throw error;

        showToast("Meal deleted", "success");
        loadMeals();
    } catch (err) {
        console.error("❌ Meal delete failed:", err);
        showToast("Could not delete meal", "error");
    }
}

function setupMealForm() {
    const form = document.getElementById("mealForm");
    if (!form) return;

    form.addEventListener("submit", handleMealSubmit);
}


// Add this missing function
function updateQRCodeAccess(subscriptionData) {
    console.log('🔓 Updating QR code access based on subscription:', subscriptionData);
    
    if (subscriptionData.hasSubscription && 
        (subscriptionData.isTrial || subscriptionData.status === 'active')) {
        // User has access - generate QR code
        generateMenuQRCode();
    } else {
        // No subscription - show locked state
        showSubscriptionRequiredQR();
    }
}

async function toggleMealAvailability(mealId, available) {
    const toggle = document.querySelector(`input[onchange*="${mealId}"]`);
    const mealCard = toggle?.closest('.meal-card');
    
    try {
        // Show loading state
        if (mealCard) {
            mealCard.classList.add('loading');
        }
        if (toggle) {
            toggle.disabled = true;
        }

        const { data, error } = await supabase
            .from('meals')
            .update({ 
                available: available,
                updated_at: new Date().toISOString()
            })
            .eq('id', mealId)
            .select();

        if (error) throw error;

        showToast(`Meal ${available ? 'available' : 'unavailable'}!`, 'success');
        
        // Update UI immediately
        if (mealCard) {
            if (available) {
                mealCard.classList.remove('unavailable');
            } else {
                mealCard.classList.add('unavailable');
            }
        }
        
    } catch (error) {
        console.error('❌ Error toggling availability:', error);
        showToast('Error updating availability: ' + error.message, 'error');
        
        // Revert toggle on error
        if (toggle) {
            toggle.checked = !available;
        }
    } finally {
        // Remove loading state
        if (mealCard) {
            mealCard.classList.remove('loading');
        }
        if (toggle) {
            toggle.disabled = false;
        }
    }
}

window.testApp = () => {
  console.log("User:", currentUser);
  console.log("Company:", currentCompany);
  console.log("Supabase client:", typeof supabase);
  console.log("MealsGrid exists?", !!document.getElementById('mealsGrid'));
};

async function loadUserData(user) {
  try {
    if (!user || !user.id) {
      console.warn("loadUserData: No valid user provided");
      return false;
    }

    console.log("📥 Loading company for user:", user.email);

    // Fetch the company tied to this user
    const { data: company, error } = await supabase
      .from("companies")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (error) {
      console.warn("❌ Company query error:", error.message);
      return false;
    }

    if (!company) {
      console.warn("❌ No company found for this user.");
      return false;
    }

    // ⭐ Store both globally and in localStorage
    window.currentUser = user;
    window.currentCompany = company;

    localStorage.setItem("currentUser", JSON.stringify(user));
    localStorage.setItem("currentCompany", JSON.stringify(company));

    console.log("🏢 Company loaded:", company);

    return true;

  } catch (err) {
    console.error("❌ loadUserData failed:", err);
    return false;
  }
}

// ===== showToast (universal version) =====
function showToast(message, type = "info") {
  let box = document.getElementById("toastBox");

  if (!box) {
    box = document.createElement("div");
    box.id = "toastBox";
    box.style.position = "fixed";
    box.style.top = "20px";
    box.style.right = "20px";
    box.style.zIndex = "99999";
    document.body.appendChild(box);
  }

  const toast = document.createElement("div");
  toast.innerText = message;
  toast.style.padding = "12px 16px";
  toast.style.marginBottom = "10px";
  toast.style.borderRadius = "6px";
  toast.style.color = "white";
  toast.style.fontSize = "14px";
  toast.style.boxShadow = "0 2px 6px rgba(0,0,0,0.2)";
  toast.style.transition = "all 0.3s ease";
  toast.style.opacity = "0";

  if (type === "success") toast.style.background = "#22c55e";
  else if (type === "error") toast.style.background = "#ef4444";
  else toast.style.background = "#3b82f6";

  box.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

async function handleSuccessfulLogin(user, session) {
  try {
    console.log("🎉 handleSuccessfulLogin triggered for:", user.email);

    // Load the user & company
    const ok = await loadUserData(user);
    if (!ok) {
      showToast("Could not load restaurant data", "error");
      return;
    }

    showToast("Welcome back, " + (user.email || "User"), "success");

    // 🔥 Correct screen switching
    document.getElementById("authScreen")?.classList.add("hidden");
    document.getElementById("loginScreen")?.classList.add("hidden");
    document.getElementById("registerScreen")?.classList.add("hidden");

    document.getElementById("appWrapper")?.classList.remove("hidden");
    document.getElementById("mainContent")?.classList.remove("hidden");

    // Give UI time to mount
    await new Promise(r => setTimeout(r, 150));

    // Now DOM exists → load meals successfully
    if (typeof loadMeals === "function") {
      await loadMeals();
    }

  } catch (err) {
    console.error("❌ Error in handleSuccessfulLogin:", err);
    showToast("Login completed but UI failed to show", "error");
  }
}

// Show dashboard
showDashboard();
showToast('Welcome back!', 'success');

// TEMPORARILY COMMENT OUT - FIX LATER
setupRealTimeNotifications();
setupRealTimeSubscriptions();

// Load additional data
setTimeout(() => {
    loadDashboardData();
    loadMeals();
    loadSubscriptionData().catch(err => console.log('Subscription load optional'));
}, 100);

function bindLogoutButton() {
  const btn = document.getElementById('logoutBtn');
  if (!btn) return console.warn('logoutBtn not found');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', (e) => {
    e.preventDefault();
    createConfirmModal('Are you sure you want to log out?', async () => {
      try {
        showLoading('Signing out...');
        cleanupRealTimeSubscriptions && cleanupRealTimeSubscriptions();
        const { error } = await supabase.auth.signOut();
        if (error) console.warn('signOut error', error);
      } catch (err) {
        console.error('Logout error', err);
      } finally {
        currentUser = null; currentCompany = null;
        localStorage.removeItem('currentUser'); localStorage.removeItem('currentCompany');
        hideLoading();
        showLoginScreen && showLoginScreen();
        showToast('Logged out', 'success');
      }
    });
  });
}

function openSubscriptionModal() {
  const m = document.getElementById('subscriptionModal');
  if (!m) return console.warn('subscriptionModal missing');

  m.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  if (typeof setupSubscriptionModal === "function") {
      setupSubscriptionModal();
  }
}

function setupMobileModalEvents() {
    const modal = document.getElementById('subscriptionModal');
    if (!modal) return;
    
    // Close modal when clicking outside (mobile-friendly)
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeModal('subscriptionModal');
        }
    });
    
    // Close on escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeModal('subscriptionModal');
        }
    });
    
    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
}

// Update the company info form handler
function setupCompanyInfoForm() {
    const companyInfoForm = document.getElementById('companyInfoForm');
    if (companyInfoForm) {
        companyInfoForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            await handleCompanyInfoUpdate();
        });
        console.log('✅ Company info form listener added');
    }
}

function downloadLocalQR(canvas) {
    const link = document.createElement('a');
    link.download = "menu-qr.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
}

function enableQRButtons(menuUrl, dataUrl, imageElement, canvasElement) {
  try {
    const downloadBtn = document.getElementById('downloadQRBtn');
    const copyBtn = document.getElementById('copyLinkBtn');
    const modalUrl = document.getElementById('qrModalUrl');
    const modalContainer = document.getElementById('qrModalContainer');

    if (modalUrl) {
      modalUrl.href = menuUrl;
      modalUrl.textContent = menuUrl;
    }
    if (modalContainer) {
      modalContainer.innerHTML = '';
      modalContainer.appendChild(imageElement.cloneNode(true));
    }

    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.onclick = async function () {
        // prefer the image element (data URL) which is 100% safe
        if (imageElement && imageElement.src) {
          triggerDownloadFromDataUrl(imageElement.src, 'restaurant-menu-qr.png');
          showToast('QR Code downloaded!', 'success');
          return;
        }

        // fallback: draw canvas to blob and download
        if (canvasElement) {
          canvasElement.toBlob((blob) => {
            if (!blob) {
              showToast('Failed to prepare QR download', 'error');
              return;
            }
            const url = URL.createObjectURL(blob);
            triggerDownloadFromBlobUrl(url, 'restaurant-menu-qr.png');
            URL.revokeObjectURL(url);
            showToast('QR Code downloaded!', 'success');
          });
          return;
        }

        showToast('No QR available to download', 'error');
      };
    }

    if (copyBtn) {
      copyBtn.disabled = false;
      copyBtn.onclick = async function () {
        try {
          await navigator.clipboard.writeText(menuUrl);
          showToast('Menu link copied to clipboard', 'success');
        } catch (err) {
          console.error('Clipboard copy failed', err);
          showToast('Copy failed - please copy manually', 'error');
        }
      };
    }

    console.log('✅ QR buttons enabled');
  } catch (err) {
    console.error('❌ enableQRButtons error', err);
  }
}

function triggerDownloadFromDataUrl(dataUrl, filename) {
  try {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    console.error('❌ triggerDownloadFromDataUrl error', e);
    showToast('Download failed', 'error');
  }
}

/* helper: trigger download from a blob url (object URL) */
function triggerDownloadFromBlobUrl(blobUrl, filename) {
  try {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    console.error('❌ triggerDownloadFromBlobUrl error', e);
    showToast('Download failed', 'error');
  }
}

function downloadQRCode() {
    // Priority 1: try direct PNG from our <img id="qrCodeImage">
    const img = document.getElementById("qrCodeImage");

    if (img && img.src && img.src.startsWith("data:image")) {
        const a = document.createElement("a");
        a.href = img.src;
        a.download = "menucheck_qr.png";
        a.click();
        return;
    }

    // Priority 2: find a QR inside a canvas (rare case)
    const canvas = document.querySelector("#qrCodeContainer canvas")
               || document.querySelector("#qrModalContainer canvas");

    if (canvas) {
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = "menucheck_qr.png";
        a.click();
        return;
    }

    // Priority 3: QR created as <img> by QRCode.js inside container
    const qrImg = document.querySelector("#qrCodeContainer img")
               || document.querySelector("#qrModalContainer img");

    if (qrImg && qrImg.src) {
        // convert image to canvas to force download
        const c = document.createElement("canvas");
        c.width = qrImg.naturalWidth || 300;
        c.height = qrImg.naturalHeight || 300;
        const ctx = c.getContext("2d");

        ctx.drawImage(qrImg, 0, 0, c.width, c.height);

        const a = document.createElement("a");
        a.href = c.toDataURL("image/png");
        a.download = "menucheck_qr.png";
        a.click();
        return;
    }

    showToast("QR code not generated yet", "error");
}


// Add to initialization section
function fixSubscriptionForm() {
    const subscriptionForm = document.getElementById('subscriptionForm');
    if (subscriptionForm) {
        // Remove existing listeners and reattach
        const newForm = subscriptionForm.cloneNode(true);
        subscriptionForm.parentNode.replaceChild(newForm, subscriptionForm);
        
        // Reattach submit handler
        document.getElementById('subscriptionForm').addEventListener('submit', handleSubscriptionSubmit);
        console.log('✅ Subscription form fixed');
    }
}

// Improve notification permission handling
async function setupEnhancedNotifications() {
    if ('Notification' in window && Notification.permission === 'default') {
        // Request permission when user first interacts with orders
        const ordersSection = document.getElementById('ordersSection');
        if (ordersSection) {
            ordersSection.addEventListener('click', async () => {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    console.log('✅ Notification permission granted');
                }
            });
        }
    }
}

// Add pagination for large exports
async function generateOptimizedExport() {
    const BATCH_SIZE = 1000;
    let allOrders = [];
    let from = 0;
    let hasMore = true;
    
    while (hasMore) {
        const { data: orders, error } = await supabase
            .from('orders')
            .select('*')
            .range(from, from + BATCH_SIZE - 1);
            
        if (error) throw error;
        
        if (orders.length < BATCH_SIZE) {
            hasMore = false;
        }
        
        allOrders = allOrders.concat(orders);
        from += BATCH_SIZE;
    }
    
    return generateProfessionalCSV(allOrders);
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Use requestAnimationFrame for DOM updates
function optimizeDOMUpdates(callback) {
    requestAnimationFrame(() => {
        callback();
    });
}


async function copyMenuLink() {
    try {
        console.log('📋 Copying menu link...');
        
        const qrUrlElement = document.getElementById('qrUrl');
        if (!qrUrlElement || !qrUrlElement.href) {
            throw new Error('Menu link not available');
        }

        const menuUrl = qrUrlElement.href;
        const copyBtn = document.getElementById('copyLinkBtn');

        // Visual feedback
        if (copyBtn) {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copying...';
            copyBtn.disabled = true;
        }

        // Method 1: Modern Clipboard API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(menuUrl);
        } 
        // Method 2: Legacy execCommand
        else {
            const textArea = document.createElement('textarea');
            textArea.value = menuUrl;
            textArea.style.position = 'fixed';
            textArea.style.left = '-9999px';
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
        }

        console.log('✅ Link copied to clipboard');
        showToast('Menu link copied!', 'success');

        // Reset button after 2 seconds
        if (copyBtn) {
            setTimeout(() => {
                copyBtn.textContent = 'Copy Link';
                copyBtn.disabled = false;
            }, 2000);
        }
        
    } catch (error) {
        console.error('❌ Copy failed:', error);
        showToast('Failed to copy. Please copy the link manually.', 'error');
    }
}

// Update your showSection function
function showSection(sectionName) {
    // ... your existing showSection code ...
    
    if (sectionName === 'settings') {
        console.log('⚙️ Settings section shown - initializing QR code...');
        
        // Wait for DOM to be ready, then initialize QR code
        setTimeout(() => {
            initializeQRCodeSection();
        }, 300);
    }
}

function closeQRModal() {
  const modal = document.querySelector('.modal');
  if (!modal) return;
  modal.style.display = 'none';
  modal.classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
  // if currentCompany is already set, generate immediately
  setTimeout(() => {
    if (currentCompany && currentCompany.id) {
      generateMenuQRCode();
    } else {
      // try to read currentCompany from localStorage if available
      try {
        const saved = localStorage.getItem('currentCompany');
        if (saved) {
          currentCompany = JSON.parse(saved);
          generateMenuQRCode();
        }
      } catch (_) {}
    }
  }, 200);
});

async function handleCompanyInfoUpdate() {
    try {
        const restaurantId = getCurrentRestaurantId();
        if (!restaurantId) {
            showError('No restaurant found');
            return;
        }

        const formData = new FormData(document.getElementById('companyInfoForm'));
        const companyData = {
            name: formData.get('restaurantName'),
            address: formData.get('restaurantAddress'),
            phone: formData.get('restaurantPhone'),
            email: formData.get('restaurantEmail'),
            description: formData.get('restaurantDescription'),
            updated_at: new Date().toISOString()
        };

        // Update in Supabase
        const { data, error } = await supabase
            .from('restaurants')
            .update(companyData)
            .eq('id', restaurantId)
            .select();

        if (error) throw error;

        showSuccess('Company information updated successfully!');
        
        // Update UI with new data
        updateCompanyInfoUI(companyData);
        
    } catch (error) {
        console.error('Company info update error:', error);
        showError('Failed to update company information: ' + error.message);
    }
}

function updateCompanyInfoUI(companyData) {
    // Update any displayed company info in the UI
    const companyNameElement = document.getElementById('displayRestaurantName');
    if (companyNameElement) {
        companyNameElement.textContent = companyData.name;
    }
}

function showCustomConfirm(callback) {
    console.log('🔓 Showing custom confirm modal');
    
    const modal = document.getElementById('customConfirmModal');
    if (modal) {
        pendingSubscriptionCallback = callback;
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        
        // Set up the confirm button with fresh event listeners
        const confirmBtn = document.getElementById('confirmTrialBtn');
        if (confirmBtn) {
            // Remove existing listeners and add fresh one
            const newConfirmBtn = confirmBtn.cloneNode(true);
            confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
            
            document.getElementById('confirmTrialBtn').addEventListener('click', function() {
                console.log('✅ Confirm trial button clicked');
                if (pendingSubscriptionCallback) {
                    pendingSubscriptionCallback();
                }
                hideCustomConfirm();
            });
        }
        
        console.log('✅ Custom confirm modal shown');
    }
}

function openPaymentUpdateModal() {
    openSubscriptionModal();
}

// Add this function to close all modals on page load
function initializeModalStates() {
    console.log('🔒 Initializing modal states...');
    
    // Close all modals on page load
    const modals = document.querySelectorAll('.modal-overlay');
    modals.forEach(modal => {
        modal.classList.add('hidden');
        modal.style.display = 'none'; // Extra safety for mobile
    });
    
    // Ensure body scroll is enabled
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.classList.remove('modal-open');
    
    // ✅ SAFELY reset any pending subscription callbacks
    if (typeof pendingSubscriptionCallback !== 'undefined') {
        pendingSubscriptionCallback = null;
    }
    if (typeof pendingAction !== 'undefined') {
        pendingAction = null;
    }
    
    console.log('✅ All modals hidden and states reset');
}

// ============================
// ENSURE SETUP RUNS ON LOAD
// ============================
document.addEventListener('DOMContentLoaded', function() {
    // Setup meal form handler
    const mealForm = document.getElementById('mealForm');
    if (mealForm) {
        mealForm.removeEventListener('submit', handleMealSubmit);
        mealForm.addEventListener('submit', handleMealSubmit);
        console.log('✅ Meal form handler attached');
    }
    
    // Setup meal delegation
    setupUnifiedMealDelegation();
});

// Call this when the page loads
document.addEventListener('DOMContentLoaded', function() {
    initializeModalStates();
    
    // Also call it when window loads as backup
    setTimeout(initializeModalStates, 100);
});

bindLogoutButton();
setupUnifiedMealDelegation && setupUnifiedMealDelegation(); // though it's IIFE so already attached
setupSubscriptionFormOnce && setupSubscriptionFormOnce();


// Add this to handle the specific subscription modal issue
function safeCloseSubscriptionModal() {
    const modal = document.getElementById('subscriptionModal');
    if (modal) {
        modal.classList.add('hidden');
    }
    document.body.style.overflow = '';
    pendingSubscriptionCallback = null;
}

function hideCustomConfirm() {
    console.log('🔒 Hiding custom confirm modal');
    
    const modal = document.getElementById('customConfirmModal');
    if (modal) {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
        
        // ✅ SAFE check for pendingSubscriptionCallback
        if (typeof pendingSubscriptionCallback !== 'undefined') {
            pendingSubscriptionCallback = null;
        }
        console.log('✅ Custom confirm modal hidden');
    }
}

// Safe initialization check
function safeInitialize() {
    console.log('🛡️ Safe initialization check...');
    
    // Ensure all critical variables exist
    if (typeof pendingSubscriptionCallback === 'undefined') {
        pendingSubscriptionCallback = null;
        console.log('✅ pendingSubscriptionCallback initialized');
    }
    
    if (typeof pendingAction === 'undefined') {
        pendingAction = null;
        console.log('✅ pendingAction initialized');
    }
    
    if (typeof currentUser === 'undefined') {
        currentUser = null;
        console.log('✅ currentUser initialized');
    }
    
    if (typeof currentCompany === 'undefined') {
        currentCompany = null;
        console.log('✅ currentCompany initialized');
    }
    
    // Initialize modal states
    initializeModalStates();
    
    console.log('🛡️ Safe initialization complete');
}

async function loadSubscriptionData() {
    try {
        if (!currentCompany) {
            console.log('No company data available for subscription');
            return;
        }
        
        const subscriptionElement = document.getElementById('currentSubscription');
        if (!subscriptionElement) {  // FIXED: was 'subscriptElement'
            console.log('Subscription element not found');
            return;
        }
        
        console.log('🔍 Loading subscription for company:', currentCompany.id);
        
        // Show loading state
        subscriptionElement.innerHTML = `
            <div class="subscription-info">
                <div class="loading-text">Loading subscription status...</div>
            </div>
        `;

        // Get subscription status from backend
        const backendUrl = window.location.origin.includes('localhost') 
            ? 'http://localhost:5000' 
            : window.location.origin;
            
        const response = await fetch(`${backendUrl}/api/paystack/subscription-status/${currentCompany.id}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const subscriptionData = await response.json();
        console.log('📊 Subscription data received:', subscriptionData);
        
        if (subscriptionData.hasSubscription) {
            console.log('✅ Found subscription:', subscriptionData);
            
            if (subscriptionData.isTrial) {
                // Trial active
                subscriptionElement.innerHTML = `
                    <div class="subscription-info">
                        <div class="subscription-status active">🎉 Free Trial Active</div>
                        <div class="subscription-details">
                            <div class="plan-name" style="font-size: 18px; font-weight: bold; color: var(--primary);">
                                ${subscriptionData.daysLeft} Days Free Trial Remaining
                            </div>
                            <div class="plan-period">Subscribe now to avoid interruption</div>
                            <div class="trial-warning" style="margin-top: 12px; padding: 10px; background: rgba(245, 158, 11, 0.1); border-radius: 8px; font-size: 13px; border-left: 3px solid var(--warning);">
                                ⚠️ <strong>After trial ends:</strong> Automatic monthly billing of ₦30,000
                            </div>
                        </div>
                        <button class="btn btn-primary" onclick="startFreeTrial()" style="margin-top: 12px;">
                            💳 Setup Payment Method
                        </button>
                    </div>
                `;
                
                // ✅ QR CODE WORKS DURING TRIAL
                generateMenuQRCode();
                
            } else if (subscriptionData.status === 'active') {
                // Active subscription
                const nextBilling = subscriptionData.next_billing_date 
                    ? new Date(subscriptionData.next_billing_date).toLocaleDateString() 
                    : 'Not set';
                    
                subscriptionElement.innerHTML = `
                    <div class="subscription-info">
                        <div class="subscription-status active">✅ Active Subscription</div>
                        <div class="subscription-details">
                            <div class="plan-name" style="font-size: 16px; font-weight: bold;">
                                ${subscriptionData.plan_name || 'Professional Plan'} - ₦${(subscriptionData.amount || 30000).toLocaleString()}/month
                            </div>
                            <div class="plan-period">Auto-renews every 30 days</div>
                            <div class="renewal-date" style="font-size: 13px; color: var(--text-muted); margin-top: 8px;">
                                Next billing: ${nextBilling}
                            </div>
                        </div>
                        <button class="btn btn-outline" onclick="cancelSubscription('${subscriptionData.id}')" style="margin-top: 12px;">
                            Cancel Subscription
                        </button>
                    </div>
                `;
                
                // ✅ QR CODE WORKS WITH ACTIVE SUBSCRIPTION
                generateMenuQRCode();
                
            } else if (subscriptionData.status === 'past_due' && subscriptionData.isInGracePeriod) {
                // Grace period active
                subscriptionElement.innerHTML = `
                    <div class="subscription-info">
                        <div class="subscription-status inactive">⚠️ Payment Failed - Grace Period</div>
                        <div class="subscription-details">
                            <div class="plan-name" style="color: var(--warning);">
                                24-hour grace period active
                            </div>
                            <div class="plan-period">Update payment method to avoid service interruption</div>
                            <div class="grace-warning" style="margin-top: 8px; padding: 8px; background: rgba(239, 68, 68, 0.1); border-radius: 6px; font-size: 12px;">
                                ❌ Service will be suspended if not resolved
                            </div>
                        </div>
                        <button class="btn btn-primary" onclick="openSubscriptionModal()" style="margin-top: 12px;">
                            Update Payment Method
                        </button>
                    </div>
                `;
                
                // ✅ QR CODE WORKS DURING GRACE PERIOD
                generateMenuQRCode();
                
            } else {
                // Subscription inactive/expired/cancelled
                subscriptionElement.innerHTML = `
                    <div class="subscription-info">
                        <div class="subscription-status inactive">❌ Subscription ${subscriptionData.status}</div>
                        <div class="subscription-details">
                            <div class="plan-name">Professional Plan - ₦30,000/month</div>
                            <div class="plan-period">Subscribe to unlock QR code and menu features</div>
                            <div class="features-list" style="margin-top: 12px; font-size: 13px; color: var(--text-muted);">
                                • QR Code Menu Generation<br>
                                • Customer Order Management<br>
                                • Real-time Order Tracking
                            </div>
                        </div>
                        <button class="btn btn-primary" onclick="startFreeTrial()" style="margin-top: 12px;">
                            Start Free Trial
                        </button>
                    </div>
                `;
                
                // ❌ DON'T GENERATE QR CODE - NO ACTIVE SUBSCRIPTION
                showSubscriptionRequiredQR();
            }
            
        } else {
            // No subscription found - start free trial
            console.log('🆕 No subscription found, offering free trial');
            subscriptionElement.innerHTML = `
                <div class="subscription-info">
                    <div class="subscription-status active">🎁 Start Free Trial</div>
                    <div class="subscription-details">
                        <div class="plan-name" style="font-size: 18px; font-weight: bold; color: var(--primary);">
                            3 Days Free Trial
                        </div>
                        <div class="plan-period">Then ₦30,000/month - Cancel anytime</div>
                        <div class="trial-features" style="margin-top: 16px; font-size: 14px; color: var(--text-secondary);">
                            <div style="display: flex; align-items: center; margin-bottom: 8px;">
                                <span style="color: var(--primary); margin-right: 8px;">✓</span>
                                Full access to all features
                            </div>
                            <div style="display: flex; align-items: center; margin-bottom: 8px;">
                                <span style="color: var(--primary); margin-right: 8px;">✓</span>
                                QR code menu generation
                            </div>
                            <div style="display: flex; align-items: center; margin-bottom: 8px;">
                                <span style="color: var(--primary); margin-right: 8px;">✓</span>
                                Order management system
                            </div>
                        </div>
                    </div>
                    <button class="btn btn-primary" onclick="startFreeTrial()" style="margin-top: 16px; padding: 12px 24px; font-size: 16px;">
                        🚀 Start Free Trial
                    </button>
                </div>
            `;
            
            // ❌ DON'T GENERATE QR CODE - NEED TO START TRIAL FIRST
            showSubscriptionRequiredQR();
        }
        
    } catch (error) {
        console.error('❌ Error loading subscription data:', error);
        // On error, show free trial as fallback
        const subscriptionElement = document.getElementById('currentSubscription');
        if (subscriptionElement) {
            subscriptionElement.innerHTML = `
                <div class="subscription-info">
                    <div class="subscription-status active">🎁 Start Free Trial</div>
                    <div class="subscription-details">
                        <div class="plan-name" style="color: var(--warning);">
                            Connection Issue - Try Free Trial
                        </div>
                        <div class="plan-period">3 days free, then ₦30,000/month</div>
                    </div>
                    <button class="btn btn-primary" onclick="startFreeTrial()" style="margin-top: 12px;">
                        Start Free Trial
                    </button>
                </div>
            `;
            showSubscriptionRequiredQR();
        }
    }
}

// ✅ Show subscription required message for QR code
function showSubscriptionRequiredQR() {
    const qrCodeContainer = document.getElementById('qrCodeContainer');
    if (qrCodeContainer) {
        qrCodeContainer.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 48px; margin-bottom: 16px;">🔒</div>
                <h3>Subscription Required</h3>
                <p>Start your free trial to generate your menu QR code</p>
                <button class="btn btn-primary" onclick="startFreeTrial()" style="margin-top: 12px;">
                    Start Free Trial
                </button>
            </div>
        `;
    }
    
    // Disable QR code buttons
    const downloadBtn = document.getElementById('downloadQRBtn');
    const copyBtn = document.getElementById('copyLinkBtn');
    if (downloadBtn) downloadBtn.disabled = true;
    if (copyBtn) copyBtn.disabled = true;
}

// ✅ Show subscription required message for QR code
function showSubscriptionRequiredQR() {
    const qrCodeContainer = document.getElementById('qrCodeContainer');
    if (qrCodeContainer) {
        qrCodeContainer.innerHTML = `
            <div class="empty-state">
                <div style="font-size: 48px; margin-bottom: 16px;">🔒</div>
                <h3>Subscription Required</h3>
                <p>Start your free trial to generate your menu QR code</p>
                <button class="btn btn-primary" onclick="startFreeTrial()" style="margin-top: 12px;">
                    Start Free Trial
                </button>
            </div>
        `;
    }
    
    // Disable QR code buttons
    const downloadBtn = document.getElementById('downloadQRBtn');
    const copyBtn = document.getElementById('copyLinkBtn');
    if (downloadBtn) downloadBtn.disabled = true;
    if (copyBtn) copyBtn.disabled = true;
}

function findDuplicateFunctions() {
    console.log('🔍 Checking for duplicate functions...');
    
    // Common function names that might have duplicates
    const commonFunctions = [
        'startFreeTrial', 'handleLogin', 'handleRegistration', 'downloadQRCode',
        'setupFormHandlers', 'showSection', 'loadMeals', 'loadOrders'
    ];
    
    commonFunctions.forEach(funcName => {
        const functionCount = (window[funcName] !== undefined) ? 1 : 0;
        console.log(`${funcName}: ${functionCount > 1 ? '❌ DUPLICATE' : '✅ OK'}`);
    });
}

// Run this in console to check for duplicates
findDuplicateFunctions();

// ✅ Start Free Trial Function
async function startFreeTrial(e) {
    if (e) e.preventDefault();
    
    console.log('🎯 Start Free Trial clicked on mobile');
    
    // Simply open the subscription modal
    openSubscriptionModal();
}

// after checkAuthState() or after user logged in
setInterval(async () => {
  if (currentCompany?.id) {
    try {
      const res = await fetch(`${API_BASE || ''}/api/paystack/subscription-status/${currentCompany.id}`);
      if (!res.ok) return;
      const json = await res.json();
      if (!json.hasSubscription || ['expired','cancelled','past_due'].includes(json.status)) {
        blockDashboardForExpiredSubscription();
      }
    } catch (e) {}
  }
}, 1000 * 60 * 5); // every 5 minutes

async function checkTrialPeriod() {
  if (!currentUser || !currentUser.id) return false;

  try {
    const { data: company, error: cError } = await supabase
      .from("companies")
      .select("created_at")
      .eq("user_id", currentUser.id)
      .single();

    if (cError) throw cError;

    const createdAt = new Date(company.created_at);
    const now = new Date();
    const diffDays = Math.ceil((now - createdAt) / (1000 * 60 * 60 * 24));

    return diffDays <= 3;
  } catch (err) {
    console.error("Error checking trial period:", err);
    return false;
  }
}

async function getTrialDaysLeft() {
  if (!currentUser || !currentUser.id) return 0;

  try {
    const { data: company, error: cError } = await supabase
      .from("companies")
      .select("created_at")
      .eq("user_id", currentUser.id)
      .single();

    if (cError) throw cError;

    const createdAt = new Date(company.created_at);
    const now = new Date();
    const diffDays = Math.ceil((now - createdAt) / (1000 * 60 * 60 * 24));

    return Math.max(0, 3 - diffDays);
  } catch (error) {
    console.error("Error getting trial days:", error);
    return 0;
  }
}


function setupCustomConfirmModal() {
    console.log('🔧 Setting up custom confirm modal...');
    
    const modal = document.getElementById('customConfirmModal');
    const closeBtn = modal?.querySelector('.btn-close');
    const cancelBtn = modal?.querySelector('.btn-secondary');
    
    if (modal) {
        // Click outside to close
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                hideCustomConfirm();
            }
        });
    }
    
    if (closeBtn) {
        closeBtn.addEventListener('click', hideCustomConfirm);
    }
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', hideCustomConfirm);
    }
    
    // Initialize pendingSubscriptionCallback
    if (typeof pendingSubscriptionCallback === 'undefined') {
        pendingSubscriptionCallback = null;
    }
    
    console.log('✅ Custom confirm modal setup complete');
}

function setupCardInputs() {
  // Format card number
  const cardNumberInput = document.getElementById('cardNumber');
  if (cardNumberInput) {
    cardNumberInput.addEventListener('input', function(e) {
      let value = e.target.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
      let formattedValue = value.match(/.{1,4}/g)?.join(' ');
      e.target.value = formattedValue || value;
    });
  }
  
  // Format expiry date
  const expiryInput = document.getElementById('expiryDate');
  if (expiryInput) {
    expiryInput.addEventListener('input', function(e) {
      let value = e.target.value.replace(/[^0-9]/g, '');
      if (value.length >= 2) {
        value = value.substring(0, 2) + '/' + value.substring(2, 4);
      }
      e.target.value = value;
    });
  }
  
  // Only allow numbers for CVV
  const cvvInput = document.getElementById('cvv');
  if (cvvInput) {
    cvvInput.addEventListener('input', function(e) {
      e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });
  }
}

// Debug: Check if function exists and is bound
console.log('🔧 handleSubscriptionSubmit function defined:', typeof handleSubscriptionSubmit);

// ✅ Cancel Subscription Function
async function cancelSubscription() {
    try {
        const confirmed = confirm(
            "Are you sure you want to cancel your subscription? You'll lose access to QR codes and menu features after your current billing period ends."
        );
        
        if (!confirmed) return;
        
        showLoading('Cancelling subscription...');
        
        // Remove from localStorage
        localStorage.removeItem(`subscription_${currentCompany.id}`);
        
        showToast('Subscription cancelled successfully', 'success');
        
        // Reload subscription data
        setTimeout(() => {
            loadSubscriptionData();
        }, 1000);
        
    } catch (error) {
        console.error('❌ Cancel subscription error:', error);
        showToast('Error cancelling subscription: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

function setupRealTimeSubscriptions() {
    if (!currentCompany) return;
    console.log('🔔 Setting up real-time subscriptions...');
    // Basic setup
}

// Add this with your other API functions (around line 2760-2800)
async function checkSubscription(companyId) {
    try {
        const response = await fetch(`/api/paystack/subscription-status/${companyId}`);
        if (response.ok) {
            const subscription = await response.json();
            
            // Check if auto-charge is enabled
            if (subscription.status === 'active' && subscription.authorization) {
                console.log('✅ Auto-debit enabled for subscription');
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error('Error checking subscription:', error);
        return false;
    }
}

// ✅ Check Payment Status After Redirect
async function checkPaymentStatus() {
    const urlParams = new URLSearchParams(window.location.search);
    const reference = urlParams.get('reference');
    const trxref = urlParams.get('trxref');
    
    if (reference || trxref) {
        const paymentRef = reference || trxref;
        console.log('🔍 Checking payment status for:', paymentRef);
        
        try {
            showLoading('Verifying payment...');
            
            const backendUrl = window.location.origin.includes('localhost') 
                ? 'http://localhost:5000' 
                : window.location.origin;
                
            const response = await fetch(`${backendUrl}/api/paystack/verify/${paymentRef}`);
            const data = await response.json();
            
            if (data.success) {
                showToast('Payment verified successfully! Your subscription is now active.', 'success');
                // Remove query parameters
                window.history.replaceState({}, document.title, window.location.pathname);
                // Reload subscription data
                setTimeout(() => {
                    loadSubscriptionData();
                }, 2000);
            } else {
                showToast('Payment verification failed. Please try again.', 'error');
            }
            
        } catch (error) {
            console.error('Payment verification error:', error);
            showToast('Error verifying payment', 'error');
        } finally {
            hideLoading();
        }
    }
}

// ✅ Call this on page load to check for payment verification
checkPaymentStatus();

async function initializeSubscription() {
    try {
        if (!currentUser || !currentCompany) {
            showToast('Please login to subscribe', 'error');
            return;
        }
        
        showLoading('Preparing your subscription...');
        
        const response = await fetch('http://localhost:5000/api/paystack/initialize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: currentUser.email,
                business_id: currentCompany.id
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Redirect to Paystack payment page
            window.location.href = data.authorization_url;
        } else {
            throw new Error(data.error || 'Failed to initialize subscription');
        }
        
    } catch (error) {
        console.error('Subscription initialization error:', error);
        showToast('Error starting subscription: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

//-----------------------------------------------------
// FIX: Forcefully attach download handler (never skip)
//-----------------------------------------------------
const downloadBtn = document.getElementById("downloadQRBtn");

downloadBtn.onclick = () => {
    try {
        const a = document.createElement("a");
        a.href = dataURL;
        a.download = `menucheck_qr_${company.id}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast("QR downloaded!", "success");
    } catch (err) {
        console.error("❌ Download failed", err);
        showToast("Download error", "error");
    }
};

// Enable the button (if not already)
downloadBtn.disabled = false;


// Company Information Functions
async function loadCompanyInfo() {
    try {
        if (!currentCompany) {
            console.log('No company data available for settings');
            return;
        }
        
        console.log('🔍 Loading company info for:', currentCompany.id);
        
        // Refresh company data from database to ensure we have the latest
        const { data: company, error } = await supabase
            .from('companies')
            .select('*')
            .eq('id', currentCompany.id)
            .single();

        if (error) {
            console.error('❌ Error loading company info:', error);
            throw error;
        }

        if (company) {
            currentCompany = company;
            generateQRCodeForCompany();

        }
        
        // Update display with current data
        document.getElementById('companyNameDisplay').textContent = currentCompany.name || 'Not set';
        document.getElementById('companyAddressDisplay').textContent = currentCompany.address || 'Not set';
        document.getElementById('companyPhoneDisplay').textContent = currentCompany.phone || 'Not set';
        document.getElementById('companyEmailDisplay').textContent = currentUser?.email || 'Not set';
        
        console.log('✅ Company info loaded successfully');
        
    } catch (error) {
        console.error('❌ Error loading company info:', error);
        showToast('Error loading restaurant information', 'error');
        
        // Fallback to current data even if refresh fails
        document.getElementById('companyNameDisplay').textContent = currentCompany?.name || 'Error loading';
        document.getElementById('companyAddressDisplay').textContent = currentCompany?.address || 'Error loading';
        document.getElementById('companyPhoneDisplay').textContent = currentCompany?.phone || 'Error loading';
        document.getElementById('companyEmailDisplay').textContent = currentUser?.email || 'Error loading';
    }
}

function openEditCompanyModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3>Edit Business Information</h3>
                <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            <form id="companyEditForm">
                <div class="input-group">
                    <label for="editCompanyName">Restaurant Name</label>
                    <input type="text" id="editCompanyName" value="${currentCompany?.name || ''}" required>
                </div>
                <div class="input-group">
                    <label for="editCompanyAddress">Address</label>
                    <textarea id="editCompanyAddress" rows="3" required>${currentCompany?.address || ''}</textarea>
                </div>
                <div class="input-group">
                    <label for="editCompanyPhone">Phone Number</label>
                    <input type="tel" id="editCompanyPhone" value="${currentCompany?.phone || ''}" required>
                </div>
                <div class="input-group">
                    <label for="editCompanyWebsite">Website (Optional)</label>
                    <input type="url" id="editCompanyWebsite" value="${currentCompany?.website || ''}">
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save Changes</button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Add form submit handler
    document.getElementById('companyEditForm').addEventListener('submit', handleCompanyEdit);
}

function toggleWhatsAppEditField() {
    const enableWhatsApp = document.getElementById('editWhatsAppEnabled');
    const whatsappField = document.getElementById('whatsappEditField');
    if (enableWhatsApp.checked) {
        whatsappField.classList.remove('hidden');
    } else {
        whatsappField.classList.add('hidden');
    }
}

// When a new order comes in
async function handleNewOrder(order) {
    try {
        // Load company settings
        const { data: company, error } = await supabase
            .from('companies')
            .select('whatsapp_enabled, whatsapp_number, order_notifications_enabled')
            .eq('id', order.company_id)
            .single();

        if (error || !company) return;

        // Check if notifications are enabled
        if (!company.order_notifications_enabled) {
            console.log('Order notifications disabled for this company');
            return;
        }

        // Send WhatsApp notification if enabled
        if (company.whatsapp_enabled && company.whatsapp_number) {
            await sendWhatsAppOrderNotification(order, company.whatsapp_number);
        }
        
        // You could also add other notification methods here (email, SMS, etc.)
        
    } catch (error) {
        console.error('Error handling new order notification:', error);
    }
}

// WhatsApp notification function
async function sendWhatsAppOrderNotification(order, whatsappNumber) {
    try {
        const orderItems = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
        const locationType = order.location_type || 'table';
        const locationNumber = order.location_number || order.table_number || 'N/A';
        
        const message = `
🆕 *NEW ORDER RECEIVED*

*Order #*: ${order.id.slice(-8)}
*Customer*: ${order.customer_name || 'Guest'}
*Phone*: ${order.customer_phone || 'Not provided'}
*Location*: ${locationType === 'room' ? 'Room' : 'Table'} ${locationNumber}
*Amount*: ₦${parseFloat(order.total_amount || 0).toLocaleString()}

*Items:*
${orderItems.map(item => `• ${item.quantity}x ${item.name} - ₦${parseFloat(item.unit_price || item.price || 0).toLocaleString()}`).join('\n')}

*Total*: ₦${parseFloat(order.total_amount || 0).toLocaleString()}

👉 Please prepare this order immediately!
        `.trim();

        // Encode message for WhatsApp URL
        const encodedMessage = encodeURIComponent(message);
        const whatsappUrl = `https://wa.me/${whatsappNumber.replace('+', '')}?text=${encodedMessage}`;
        
        // Open WhatsApp (or you could use WhatsApp Business API for automated sending)
        window.open(whatsappUrl, '_blank');
        
    } catch (error) {
        console.error('Error sending WhatsApp notification:', error);
    }
}

function cancelEditCompanyInfo() {
  loadCompanyInfo();
}

// Test backend connection on app start
async function testBackendConnection() {
    const isHealthy = await checkBackendHealth();
    if (!isHealthy) {
        console.error('❌ Backend is not accessible');
        showToast('Backend server is not running. Please start the server on port 5000.', 'error');
    } else {
        console.log('✅ Backend is running');
    }
}

function testBasicDownload() {
    // Create a simple test image and try to download it
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    
    // Draw a simple test pattern
    ctx.fillStyle = 'red';
    ctx.fillRect(0, 0, 200, 200);
    ctx.fillStyle = 'white';
    ctx.font = '20px Arial';
    ctx.fillText('TEST QR', 50, 100);
    
    // Try to download
    const link = document.createElement('a');
    link.download = 'test_image.png';
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    console.log('✅ Test download completed');
}

// Debug the current state
function debugQRState() {
    console.log('=== QR CODE STATE DEBUG ===');
    
    // Check if we're in the settings section
    const settingsSection = document.getElementById('settingsSection');
    console.log('1. Settings section active:', settingsSection?.classList.contains('active'));
    console.log('2. Settings section visible:', settingsSection?.style.display !== 'none');
    
    // Check company data
    console.log('3. Current company:', currentCompany);
    console.log('4. Company ID:', currentCompany?.id);
    
    // Check QR container
    const qrContainer = document.getElementById('qrCodeContainer');
    console.log('5. QR container exists:', !!qrContainer);
    console.log('6. QR container content:', qrContainer?.innerHTML);
    
    // Check buttons
    const downloadBtn = document.getElementById('downloadQRBtn');
    const copyBtn = document.getElementById('copyLinkBtn');
    console.log('7. Download button disabled:', downloadBtn?.disabled);
    console.log('8. Copy button disabled:', copyBtn?.disabled);
    
    // Check if QR code was ever generated
    console.log('9. QR code image exists:', qrContainer?.querySelector('img'));
    console.log('10. QR code canvas exists:', qrContainer?.querySelector('canvas'));
    
    console.log('=== END DEBUG ===');
}

// Helper Functions
function enableQRButtons() {
    console.log('🔄 Enabling QR buttons...');
    
    const downloadBtn = document.getElementById('downloadQRBtn');
    const copyBtn = document.getElementById('copyLinkBtn');
    
    console.log('Download button found:', !!downloadBtn);
    console.log('Copy button found:', !!copyBtn);
    
    if (downloadBtn) {
        downloadBtn.disabled = false;
        // Completely remove and recreate the button to ensure clean event listener
        const newDownloadBtn = downloadBtn.cloneNode(true);
        downloadBtn.parentNode.replaceChild(newDownloadBtn, downloadBtn);
        document.getElementById('downloadQRBtn').onclick = downloadQRCode;
        console.log('✅ Download button enabled and listener set');
    }
    
    if (copyBtn) {
        copyBtn.disabled = false;
        // Completely remove and recreate the button to ensure clean event listener
        const newCopyBtn = copyBtn.cloneNode(true);
        copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
        document.getElementById('copyLinkBtn').onclick = copyMenuLink;
        console.log('✅ Copy button enabled and listener set');
    }
}


function disableQRButtons() {
    const downloadBtn = document.getElementById('downloadQRBtn');
    const copyBtn = document.getElementById('copyLinkBtn');
    
    if (downloadBtn) downloadBtn.disabled = true;
    if (copyBtn) copyBtn.disabled = true;
}

function handleQRCodeError(error) {
    const qrCodeContainer = document.getElementById('qrCodeContainer');
    if (qrCodeContainer) {
        qrCodeContainer.innerHTML = `
            <div class="error-state">
                <div style="font-size: 48px; margin-bottom: 16px;">❌</div>
                <h3>QR Code Error</h3>
                <p>${error.message}</p>
                <button class="btn btn-primary" onclick="generateMenuQRCode()" style="margin-top: 12px;">
                    Retry Generation
                </button>
            </div>
        `;
    }
    disableQRButtons();
}

function disableQRButtons() {
    const downloadBtn = document.getElementById('downloadQRBtn');
    const copyBtn = document.getElementById('copyLinkBtn');
    
    if (downloadBtn) downloadBtn.disabled = true;
    if (copyBtn) copyBtn.disabled = true;
}

// Test function to verify everything works
function testQRFunctionality() {
    console.log('🧪 Testing QR functionality...');
    debugQRButtons();
    
    // Simulate a successful QR generation
    if (currentCompany?.id) {
        console.log('✅ Company data available, testing buttons...');
        enableQRButtons();
    } else {
        console.log('❌ No company data available');
    }
}

// Settings Section Functions
function editCompanyInfo() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3>Edit Company Information</h3>
                <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            <form id="companyEditForm" onsubmit="handleCompanyEdit(event)">
                <div class="input-group">
                    <label for="editCompanyName">Restaurant Name</label>
                    <input type="text" id="editCompanyName" value="${currentCompany?.name || ''}" required>
                </div>
                <div class="input-group">
                    <label for="editCompanyAddress">Address</label>
                    <textarea id="editCompanyAddress" rows="3" required>${currentCompany?.address || ''}</textarea>
                </div>
                <div class="input-group">
                    <label for="editCompanyPhone">Phone Number</label>
                    <input type="tel" id="editCompanyPhone" value="${currentCompany?.phone || ''}" required>
                </div>
                <div class="input-group">
                    <label for="editCompanyWebsite">Website (Optional)</label>
                    <input type="url" id="editCompanyWebsite" value="${currentCompany?.website || ''}">
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save Changes</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(modal);
}

async function handleCompanyEdit(e) {
    e.preventDefault();
    
    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');
    
    try {
        setButtonLoading(submitButton, true, 'Saving...');
        
        const companyData = {
            name: document.getElementById('editCompanyName').value.trim(),
            address: document.getElementById('editCompanyAddress').value.trim(),
            phone: document.getElementById('editCompanyPhone').value.trim(),
            website: document.getElementById('editCompanyWebsite').value.trim()
        };

        const { error } = await supabase
            .from('companies')
            .update(companyData)
            .eq('id', currentCompany.id);

        if (error) throw error;

        // Update local state
        currentCompany = { ...currentCompany, ...companyData };
        
        showToast('Company information updated successfully!', 'success');
        form.closest('.modal-overlay').remove();
        loadCompanyInfo();
        
    } catch (error) {
        console.error('Error updating company:', error);
        showToast('Error updating company: ' + error.message, 'error');
    } finally {
        setButtonLoading(submitButton, false);
    }
}

function changePassword() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3>Change Password</h3>
                <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            <form id="passwordChangeForm" onsubmit="handlePasswordChange(event)">
                <div class="input-group">
                    <label for="currentPassword">Current Password</label>
                    <input type="password" id="currentPassword" required>
                </div>
                <div class="input-group">
                    <label for="newPassword">New Password</label>
                    <input type="password" id="newPassword" required minlength="6">
                </div>
                <div class="input-group">
                    <label for="confirmPassword">Confirm New Password</label>
                    <input type="password" id="confirmPassword" required>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Change Password</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(modal);
}

async function handlePasswordChange(e) {
    e.preventDefault();
    
    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');
    
    try {
        setButtonLoading(submitButton, true, 'Changing...');
        
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        if (newPassword !== confirmPassword) {
            throw new Error('New passwords do not match');
        }

        if (newPassword.length < 6) {
            throw new Error('Password must be at least 6 characters');
        }

        const { error } = await supabase.auth.updateUser({
            password: newPassword
        });

        if (error) throw error;

        showToast('Password changed successfully!', 'success');
        form.closest('.modal-overlay').remove();
        
    } catch (error) {
        console.error('Password change error:', error);
        showToast('Error changing password: ' + error.message, 'error');
    } finally {
        setButtonLoading(submitButton, false);
    }
}

// Support Section Functions
async function handleSupportSubmit(e) {
    e.preventDefault();
    
    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');
    
    try {
        setButtonLoading(submitButton, true, 'Sending...');
        
        const name = document.getElementById('supportName').value.trim();
        const email = document.getElementById('supportEmail').value.trim();
        const message = document.getElementById('supportMessage').value.trim();

        if (!name || !email || !message) {
            throw new Error('Please fill in all fields');
        }

        // Format WhatsApp message
        const whatsappMessage = `*Support Request from ${currentCompany.name}*\n\n*Name:* ${name}\n*Email:* ${email}\n*Message:* ${message}\n\n*Restaurant:* ${currentCompany.name}\n*Generated:* ${new Date().toLocaleString()}`;
        
        // Encode for URL
        const encodedMessage = encodeURIComponent(whatsappMessage);
        const whatsappUrl = `https://wa.me/2348111111111?text=${encodedMessage}`;
        
        // Redirect to WhatsApp
        window.location.href = whatsappUrl;
        
        // Close modal after a delay to allow redirect
        setTimeout(() => {
            closeModal('supportModal');
        }, 1000);
        
    } catch (error) {
        console.error('Support submit error:', error);
        showToast('Error: ' + error.message, 'error');
        setButtonLoading(submitButton, false);
    }
}

// Add this function to set up real-time subscriptions
function setupRealTimeSubscriptions() {
    // Add safety check
    if (!currentCompany || !currentCompany.id) {
        console.log('⚠️ No company data for real-time subscriptions');
        return;
    }
    
    console.log('🔔 Setting up real-time subscriptions for company:', currentCompany.id);

    // Real-time for meals
    const mealsSubscription = supabase
        .channel('meals-changes')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'meals',
                filter: `company_id=eq.${currentCompany.id}`
            },
            (payload) => {
                console.log('Real-time meal update:', payload);
                if (document.getElementById('mealsSection')?.classList.contains('active')) {
                    loadMeals(); // Refresh meals list
                }
            }
        )
        .subscribe();

    // Real-time for orders
    const ordersSubscription = supabase
        .channel('orders-changes')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'orders',
                filter: `company_id=eq.${currentCompany.id}`
            },
            (payload) => {
                console.log('Real-time order update:', payload);
                if (document.getElementById('ordersSection')?.classList.contains('active')) {
                    loadOrders(); // Refresh orders list
                }
                if (document.getElementById('dashboardSection')?.classList.contains('active')) {
                    loadDashboardData(); // Refresh dashboard
                }
            }
        )
        .subscribe();

    return { mealsSubscription, ordersSubscription };
}

// Helper function to get selected meals
function getSelectedMeals() {
    const selectedMeals = [];
    const checkboxes = document.querySelectorAll('#menuMealsContainer input[type="checkbox"]:checked');
    checkboxes.forEach(checkbox => {
        selectedMeals.push(checkbox.value);
    });
    return selectedMeals;
}

async function forceLogout() {
    console.log('🔄 FORCE LOGOUT TRIGGERED');
    await supabase.auth.signOut();
    localStorage.clear();
    sessionStorage.clear();
    currentUser = null;
    currentCompany = null;
    showLoginScreen();
}

// UI Functions
function showLoginScreen() {
    console.log('📱 Showing login screen');
    const loginScreen = document.getElementById('loginScreen');
    const dashboard = document.getElementById('dashboard');
    
    if (loginScreen) loginScreen.classList.remove('hidden');
    if (dashboard) dashboard.classList.add('hidden');
}

function showDashboard() {
    console.log('📊 Showing dashboard');
    const loginScreen = document.getElementById('loginScreen');
    const dashboard = document.getElementById('dashboard');
    
    if (loginScreen) loginScreen.classList.add('hidden');
    if (dashboard) dashboard.classList.remove('hidden');
    showSection('dashboard');
}

function showSection(sectionName) {
    console.log('🎯 Showing section:', sectionName);
    
    // Hide all sections
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
        section.style.display = 'none';
    });
    
    // Remove active class from all nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Show target section
    const targetSection = document.getElementById(`${sectionName}Section`);
    if (targetSection) {
        targetSection.classList.add('active');
        targetSection.style.display = 'block';
    }
    
    // Activate corresponding nav item
    const targetNavItem = document.querySelector(`[data-section="${sectionName}"]`);
    if (targetNavItem) {
        targetNavItem.classList.add('active');
    }
    
    // Load section-specific data
    loadSectionData(sectionName);
    
    // SPECIAL: Generate QR code when settings section is shown
    if (sectionName === 'settings') {
        console.log('🎯 Settings section shown - generating QR code...');
        
        // Wait for DOM to be fully ready
        setTimeout(() => {
            if (currentCompany && currentCompany.id) {
                generateMenuQRCode();
            } else {
                console.log('⚠️ Company data not ready, will retry in 1 second');
                setTimeout(() => {
                    if (currentCompany && currentCompany.id) {
                        generateMenuQRCode();
                    } else {
                        showQRCodeError('Company data not loaded. Please refresh the page.');
                    }
                }, 1000);
            }
        }, 500);
    }
}

/*******************************
 * SUBSCRIPTION ACCESS CONTROL
 * - Enforces trial countdown and renew-only UI.
 * - Polls status while on trial or past_due.
 *******************************/

const SUBSCRIPTION_POLL_INTERVAL_MS = 30_000; // 30s while relevant
let _subscriptionPollHandle = null;
let _currentSubscriptionState = null;

async function enforceSubscription(companyId) {
  if (!companyId) {
    console.warn('enforceSubscription: no companyId');
    return;
  }

  try {
    // call the backend route you already have
    const res = await fetch(`/api/paystack/subscription-status/${companyId}`, { method: 'GET', credentials: 'same-origin' });
    if (!res.ok) {
      console.warn('Subscription status fetch failed', res.status);
      return;
    }
    const payload = await res.json();

    // payload contains: status, isTrial, daysLeft, isInGracePeriod, etc.
    _currentSubscriptionState = payload;

    // Decide UX
    const status = (payload.status || '').toLowerCase();

    if (status === 'trialing' || payload.isTrial) {
      // show countdown + allow full access
      renderTrialUI(payload);
      startSubscriptionPolling(companyId); // poll to detect activation/expiry
      return;
    }

    if (status === 'past_due' || status === 'expired' || status === 'cancelled') {
      // block access + show renew screen
      showRenewOnlyScreen(payload);
      startSubscriptionPolling(companyId); // poll to detect payment success after user renews
      return;
    }

    // default: active or unknown but assumed active
    hideRenewOnlyScreen();
    stopSubscriptionPolling();
    renderActiveSubscriptionUI(payload);

  } catch (err) {
    console.error('enforceSubscription error:', err);
  }
}

/* Polling so the UI will auto-refresh when webhook flips status */
function startSubscriptionPolling(companyId) {
  stopSubscriptionPolling();
  _subscriptionPollHandle = setInterval(() => {
    enforceSubscription(companyId);
  }, SUBSCRIPTION_POLL_INTERVAL_MS);
}

function stopSubscriptionPolling() {
  if (_subscriptionPollHandle) {
    clearInterval(_subscriptionPollHandle);
    _subscriptionPollHandle = null;
  }
}

/* UI: Trial mode — show countdown but allow full dashboard interaction */
function renderTrialUI(payload) {
  // payload.daysLeft expected (server calculates)
  const daysLeft = Number(payload.daysLeft || 0);
  const el = document.getElementById('currentSubscription');
  if (el) {
    el.innerHTML = `
      <div class="trial-banner">
        🎁 <strong>Trial:</strong> ${daysLeft > 0 ? `${daysLeft} day${daysLeft>1?'s':''} left` : 'Expires today'}
        <button class="btn btn-outline btn-sm" id="manageSubscriptionBtn_inline">Manage</button>
      </div>
    `;
    const btn = document.getElementById('manageSubscriptionBtn_inline');
    if (btn) btn.addEventListener('click', () => openSubscriptionModal());
  }

  // ensure main dashboard remains available
  document.getElementById('dashboard')?.classList.remove('locked-by-subscription');
  hideRenewOnlyScreen();
}

/* UI: Active subscription state (normal) */
function renderActiveSubscriptionUI(payload) {
  const el = document.getElementById('currentSubscription');
  if (el) {
    const next = payload.current_period_end ? `Next billing: ${new Date(payload.current_period_end).toLocaleDateString()}` : 'Active';
    el.innerHTML = `<div class="active-subscription">🟢 ${next} <button class="btn btn-outline btn-sm" id="manageSubscriptionBtn_inline">Manage</button></div>`;
    const btn = document.getElementById('manageSubscriptionBtn_inline');
    if (btn) btn.addEventListener('click', () => openSubscriptionModal());
  }
  document.getElementById('dashboard')?.classList.remove('locked-by-subscription');
  hideRenewOnlyScreen();
}

/* UI: Block everything and show a "Renew Subscription" screen (dynamic overlay)
   This does not change your HTML file; it creates an overlay so you don't need to edit index.html.
*/
function showRenewOnlyScreen(payload = {}) {
  // mark locked state
  document.getElementById('dashboard')?.classList.add('locked-by-subscription');

  // create overlay div once
  let overlay = document.getElementById('subscriptionLockOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'subscriptionLockOverlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(255,255,255,0.95)';
    overlay.style.zIndex = 9999;
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '24px';
    overlay.innerHTML = `
      <div style="max-width:720px;width:100%;text-align:center;">
        <h2 style="margin-bottom:8px">Subscription required 🔒</h2>
        <p style="color:#444;margin-bottom:16px">Your subscription is ${payload.status || 'inactive'}. To continue using the dashboard please renew.</p>
        <div style="display:flex;gap:12px;justify-content:center">
          <button class="btn btn-primary" id="renewNowBtn">Renew Now</button>
          <button class="btn btn-outline" id="contactSupportBtn">Contact Support</button>
        </div>
        <div style="margin-top:18px;color:#777;font-size:13px">If you recently paid, wait a moment for the server to process — the page will auto-refresh when status updates.</div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('renewNowBtn')?.addEventListener('click', () => {
      // open the same payment modal you have
      openSubscriptionModal();
    });
    document.getElementById('contactSupportBtn')?.addEventListener('click', () => {
      openSupportModal?.() || showToast('Open support modal not found');
    });
  } else {
    overlay.style.display = 'flex';
  }
}

/* hide overlay and restore access */
function hideRenewOnlyScreen() {
  const overlay = document.getElementById('subscriptionLockOverlay');
  if (overlay) overlay.style.display = 'none';
  document.getElementById('dashboard')?.classList.remove('locked-by-subscription');
}

/* helper: when user triggers "Start Free Trial" we should call initialize-subscription flow.
   Use your existing function that initializes subscriptions — if you named it differently, call it.
*/
async function startTrialAndOpenPaystack(email, businessId, userId) {
  try {
    const r = await fetch('/api/paystack/initialize-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, business_id: businessId, user_id: userId })
    });
    const body = await r.json();
    if (!body.success) throw new Error(body.error || 'init failed');
    // redirect user to paystack authorisation URL to add card / pay
    window.location.href = body.authorization_url;
  } catch (err) {
    console.error('startTrialAndOpenPaystack error:', err);
    showToast('Failed to start trial: ' + (err.message || ''), 'error');
  }
}


function loadSectionData(sectionName) {
    console.log('📥 Loading data for section:', sectionName);
    
    // Only load data if the section is active
    const targetSection = document.getElementById(`${sectionName}Section`);
    if (!targetSection || !targetSection.classList.contains('active')) {
        console.log('⚠️ Section not active, skipping data load:', sectionName);
        return;
    }
    
    switch(sectionName) {
        case 'dashboard':
            loadDashboardData();
            break;
        case 'meals':
            loadMeals();
            break;
        case 'orders':
            loadOrders();
            break;
        case 'settings':
    loadCompanyInfo();
    loadWhatsAppSettings(); // ADD THIS LINE
    // Load subscription data but don't block if it fails
    loadSubscriptionData().catch(error => {
        console.log('Subscription data not available, continuing...');
    });
    // QR code is now generated automatically in showSection
    break;
    }
}

function showPasswordResetModal() {
    console.log('🔓 Opening password reset modal...');
    const modal = document.getElementById('passwordResetModal');
    if (modal) {
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }
}
async function getFallbackSubscriptionStatus() {
    console.log('🔄 Using fallback subscription check');
    
    // Check if company has a created_at date for trial calculation
    if (!currentCompany?.created_at) {
        return {
            hasSubscription: false,
            isTrial: true,
            daysLeft: 3,
            status: 'trial'
        };
    }
    
    // Calculate trial days based on company creation date
    const createdAt = new Date(currentCompany.created_at);
    const now = new Date();
    const diffTime = Math.abs(now - createdAt);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const daysLeft = Math.max(0, 3 - diffDays);
    
    // Check localStorage for manual subscription status
    const manualSubscription = localStorage.getItem(`subscription_${currentCompany.id}`);
    
    if (manualSubscription) {
        const subData = JSON.parse(manualSubscription);
        return {
            hasSubscription: true,
            isTrial: subData.status === 'trialing',
            daysLeft: daysLeft,
            status: subData.status,
            plan_name: subData.plan_name || 'Professional Plan',
            amount: subData.amount || 30000
        };
    }
    
    // Default: show free trial
    return {
        hasSubscription: false,
        isTrial: true,
        daysLeft: daysLeft,
        status: 'trial'
    };
}

function displaySubscriptionStatus(subscriptionData) {
    const subscriptionElement = document.getElementById('currentSubscription');
    if (!subscriptionElement) return;
    
    if (subscriptionData.hasSubscription) {
        if (subscriptionData.isTrial) {
            // Trial active
            subscriptionElement.innerHTML = `
                <div class="subscription-info">
                    <div class="subscription-status active">🎉 Free Trial Active</div>
                    <div class="subscription-details">
                        <div class="plan-name" style="font-size: 18px; font-weight: bold; color: var(--primary);">
                            ${subscriptionData.daysLeft} Days Free Trial Remaining
                        </div>
                        <div class="plan-period">Subscribe now to avoid interruption</div>
                        <div class="trial-warning" style="margin-top: 12px; padding: 10px; background: rgba(245, 158, 11, 0.1); border-radius: 8px; font-size: 13px; border-left: 3px solid var(--warning);">
                            ⚠️ <strong>After trial ends:</strong> Automatic monthly billing of ₦30,000
                        </div>
                    </div>
                    <button class="btn btn-primary" onclick="startFreeTrial()" style="margin-top: 12px;">
                        💳 Setup Payment Method
                    </button>
                </div>
            `;
            
        } else if (subscriptionData.status === 'active') {
            // Active subscription
            subscriptionElement.innerHTML = `
                <div class="subscription-info">
                    <div class="subscription-status active">✅ Active Subscription</div>
                    <div class="subscription-details">
                        <div class="plan-name" style="font-size: 16px; font-weight: bold;">
                            ${subscriptionData.plan_name || 'Professional Plan'} - ₦${(subscriptionData.amount || 30000).toLocaleString()}/month
                        </div>
                        <div class="plan-period">Auto-renews every 30 days</div>
                    </div>
                    <button class="btn btn-outline" onclick="cancelSubscription()" style="margin-top: 12px;">
                        Cancel Subscription
                    </button>
                </div>
            `;
            
        } else {
            // Subscription inactive
            subscriptionElement.innerHTML = `
                <div class="subscription-info">
                    <div class="subscription-status inactive">❌ Subscription ${subscriptionData.status}</div>
                    <div class="subscription-details">
                        <div class="plan-name">Professional Plan - ₦30,000/month</div>
                        <div class="plan-period">Subscribe to unlock QR code and menu features</div>
                    </div>
                    <button class="btn btn-primary" onclick="startFreeTrial()" style="margin-top: 12px;">
                        Start Free Trial
                    </button>
                </div>
            `;
        }
        
    } else {
        // No subscription found - start free trial
        showFreeTrialOffer();
    }
    
    // Generate QR code based on subscription status
    updateQRCodeAccess(subscriptionData);
}

function showFreeTrialOffer() {
    const subscriptionElement = document.getElementById('currentSubscription');
    if (!subscriptionElement) return;
    
    subscriptionElement.innerHTML = `
        <div class="subscription-info">
            <div class="subscription-status active">🎁 Start Free Trial</div>
            <div class="subscription-details">
                <div class="plan-name" style="font-size: 18px; font-weight: bold; color: var(--primary);">
                    3 Days Free Trial
                </div>
                <div class="plan-period">Then ₦30,000/month - Cancel anytime</div>
                <div class="trial-features" style="margin-top: 16px; font-size: 14px; color: var(--text-secondary);">
                    <div style="display: flex; align-items: center; margin-bottom: 8px;">
                        <span style="color: var(--primary); margin-right: 8px;">✓</span>
                        Full access to all features
                    </div>
                    <div style="display: flex; align-items: center; margin-bottom: 8px;">
                        <span style="color: var(--primary); margin-right: 8px;">✓</span>
                        QR code menu generation
                    </div>
                    <div style="display: flex; align-items: center; margin-bottom: 8px;">
                        <span style="color: var(--primary); margin-right: 8px;">✓</span>
                        Order management system
                    </div>
                </div>
            </div>
            <button class="btn btn-primary" onclick="startFreeTrial()" style="margin-top: 16px; padding: 12px 24px; font-size: 16px;">
                🚀 Start Free Trial
            </button>
        </div>
    `;
}

// FALLBACK ON ERROR
function showFreeTrialFallback() {
    const subscriptionElement = document.getElementById('currentSubscription');
    if (!subscriptionElement) return;
    
    subscriptionElement.innerHTML = `
        <div class="subscription-info">
            <div class="subscription-status active">🎁 Start Free Trial</div>
            <div class="subscription-details">
                <div class="plan-name" style="color: var(--warning);">
                    Connection Issue - Try Free Trial
                </div>
                <div class="plan-period">3 days free, then ₦30,000/month</div>
            </div>
            <button class="btn btn-primary" onclick="startFreeTrial()" style="margin-top: 12px;">
                Start Free Trial
            </button>
        </div>
    `;
}

function debugSectionVisibility() {
    console.log('🔍 DEBUG: Checking section visibility...');
    
    const sections = ['dashboard', 'meals', 'orders', 'settings'];
    sections.forEach(section => {
        const sectionElement = document.getElementById(`${section}Section`);
        const isActive = sectionElement?.classList.contains('active');
        const displayStyle = sectionElement ? getComputedStyle(sectionElement).display : 'none';
        
        console.log(`${section}Section:`, {
            exists: !!sectionElement,
            hasActiveClass: isActive,
            display: displayStyle,
            isVisible: isActive && displayStyle !== 'none'
        });
    });
}

// Run this in browser console: debugSectionVisibility()

// Add to setupEventListeners function:
const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
if (forgotPasswordBtn) {
    forgotPasswordBtn.addEventListener('click', showPasswordResetModal);
}

const closePasswordResetModal = document.getElementById('closePasswordResetModal');
if (closePasswordResetModal) {
    closePasswordResetModal.addEventListener('click', hidePasswordResetModal);
}

const cancelPasswordReset = document.getElementById('cancelPasswordReset');
if (cancelPasswordReset) {
    cancelPasswordReset.addEventListener('click', hidePasswordResetModal);
}

const passwordResetForm = document.getElementById('passwordResetForm');
if (passwordResetForm) {
    passwordResetForm.addEventListener('submit', handlePasswordReset);
}


// ============================
// FIXED PASSWORD RESET FUNCTIONALITY
// ============================

function setupPasswordResetListeners() {
    const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
    const closePasswordResetModal = document.getElementById('closePasswordResetModal');
    const cancelPasswordReset = document.getElementById('cancelPasswordReset');
    const passwordResetForm = document.getElementById('passwordResetForm');
    
    if (forgotPasswordBtn) {
        forgotPasswordBtn.addEventListener('click', showPasswordResetModal);
    }
    
    if (closePasswordResetModal) {
        closePasswordResetModal.addEventListener('click', hidePasswordResetModal);
    }
    
    if (cancelPasswordReset) {
        cancelPasswordReset.addEventListener('click', hidePasswordResetModal);
    }
    
    if (passwordResetForm) {
        // Remove existing listener and add fresh one
        const newForm = passwordResetForm.cloneNode(true);
        passwordResetForm.parentNode.replaceChild(newForm, passwordResetForm);
        document.getElementById('passwordResetForm').addEventListener('submit', handlePasswordReset);
    }
}

// Add password reset functions
function hidePasswordResetModal() {
    const modal = document.getElementById('passwordResetModal');
    if (modal) {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
    }
}

function hidePasswordResetModal() {
    const modal = document.getElementById('passwordResetModal');
    if (modal) {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
    }
}

async function handlePasswordReset(e) {
    if (e) e.preventDefault();
    
    const email = document.getElementById('resetEmail')?.value.trim();
    
    if (!email) {
        showToast('Please enter your email address', 'error');
        return;
    }
    
    try {
        showLoading('Sending reset link...');
        
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password.html`,
        });

        if (error) throw error;

        showToast('Password reset link sent to your email!', 'success');
        hidePasswordResetModal();
        
    } catch (error) {
        console.error('Password reset error:', error);
        showToast('Error: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function testSupabaseConnection() {
    console.log('🔗 Testing Supabase connection...');
    
    try {
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
            console.error('❌ Supabase connection failed:', error);
            showToast('Database connection issue', 'error');
            return false;
        }
        
        console.log('✅ Supabase connection successful');
        console.log('Session exists:', !!data.session);
        return true;
        
    } catch (error) {
        console.error('💥 Supabase test crashed:', error);
        showToast('Database connection failed', 'error');
        return false;
    }
}

// === Login handler (implement this if missing) ===
async function handleLogin(e) {
  // defensive: if invoked without event, allow manual call
  if (e && typeof e.preventDefault === 'function') e.preventDefault();

  const emailEl = document.getElementById('loginUsername');
  const passEl  = document.getElementById('loginPassword');
  const submitBtn = document.querySelector('#loginForm button[type="submit"]');

  const email = (emailEl && emailEl.value || '').trim();
  const password = (passEl && passEl.value || '').trim();

  // basic validation
  if (!email || !password) {
    showToast && showToast('Please enter both email and password', 'error');
    return;
  }

  try {
    // show immediate feedback on the UI
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerText = 'Signing in...';
    }

    // call your robust login helper (it exists in your file)
    // emergencyLogin already wraps supabase and does connection checks.
    const result = await emergencyLogin(email, password);

    // emergencyLogin should either throw on error or return successful data
    // If it returns user/session object, proceed to post-login flows.
    if (result && result.user) {
      console.log('✅ Login successful', result.user);
      // keep the canonical post-login handler name — adjust if your app uses another
      if (typeof handleSuccessfulLogin === 'function') {
        await handleSuccessfulLogin(result.user, result.session);
      } else {
        // minimal fallback: hide login screen, show dashboard
        document.getElementById('loginScreen')?.classList.add('hidden');
        document.getElementById('dashboard')?.classList.remove('hidden');
      }
    } else {
      // If emergencyLogin resolves without throwing but no user, show message
      showToast && showToast('Unable to sign in. Check credentials.', 'error');
    }

  } catch (error) {
    console.error('❌ handleLogin error:', error);
    // standardize message for the UI
    const msg = (error && error.message) ? error.message : 'Sign in failed';
    showToast && showToast(msg, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = 'Sign In';
    }
  }
}

async function handleRegistration(e) {
  e.preventDefault();

  const username = document.getElementById("regUsername").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value.trim();

  const company_name = document.getElementById("regCompanyName").value.trim();
  const company_address = document.getElementById("regCompanyAddress").value.trim();
  const company_phone = document.getElementById("regCompanyPhone").value.trim();
  const company_website = document.getElementById("regCompanyWebsite").value.trim() || null;

  try {
    // 1. Create Auth User
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) throw authError;

    const userId = authData.user.id;

    // 2. Create Admin Record
    const { error: adminError } = await supabase.from("admins").insert({
      user_id: userId,
      username,
      email
    });

    if (adminError) throw adminError;

    // 3. Create Company (THIS WAS MISSING)
    const { error: companyError } = await supabase.from("companies").insert({
      user_id: userId,
      name: company_name,
      address: company_address,
      phone: company_phone,
      website: company_website
    });

    if (companyError) throw companyError;

    showToast("Account created successfully! Please log in.", "success");

    closeRegisterModal();
    showLoginScreen();

  } catch (err) {
    console.error("❌ Registration error:", err);
    showToast(err.message, "error");
  }
}

// === Minimal auth UI wiring (attach missing listeners safely) ===
function setupAuthUiListeners() {
  // Login form submit -> handleLogin
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    // remove old anonymous listeners if any (no-op if not attached)
    loginForm.removeEventListener('submit', handleLogin);
    loginForm.addEventListener('submit', handleLogin);
    console.log('✅ loginForm wired to handleLogin');
  }

  // Show register modal button
  const showRegisterBtn = document.getElementById('showRegisterBtn');
  const closeRegisterModal = document.getElementById('closeRegisterModal');
  const cancelRegisterBtn = document.getElementById('cancelRegisterBtn');

  if (showRegisterBtn && typeof showRegisterModal === 'function') {
    showRegisterBtn.removeEventListener('click', showRegisterModal);
    showRegisterBtn.addEventListener('click', showRegisterModal);
    console.log('✅ showRegisterBtn attached');
  }
  if (closeRegisterModal && typeof hideRegisterModal === 'function') {
    closeRegisterModal.removeEventListener('click', hideRegisterModal);
    closeRegisterModal.addEventListener('click', hideRegisterModal);
  }
  if (cancelRegisterBtn && typeof hideRegisterModal === 'function') {
    cancelRegisterBtn.removeEventListener('click', hideRegisterModal);
    cancelRegisterBtn.addEventListener('click', hideRegisterModal);
  }

  // Forgot password button -> open reset modal
  const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
  if (forgotPasswordBtn && typeof showPasswordResetModal === 'function') {
    forgotPasswordBtn.removeEventListener('click', showPasswordResetModal);
    forgotPasswordBtn.addEventListener('click', showPasswordResetModal);
    console.log('✅ forgotPasswordBtn attached');
  }

  // Ensure password reset form handler is attached (you already have handlePasswordReset)
  const passwordResetForm = document.getElementById('passwordResetForm');
  if (passwordResetForm) {
    passwordResetForm.removeEventListener('submit', handlePasswordReset);
    passwordResetForm.addEventListener('submit', handlePasswordReset);
    console.log('✅ passwordResetForm submit attached');
  }
}

// Call it once during initialization (put this near other setup calls)
setupAuthUiListeners();


// Enhanced login with better error handling
async function emergencyLogin(email, password) {
    console.log('🚨 EMERGENCY LOGIN ATTEMPT');
    
    try {
        // Test connection first
        const connectionOk = await testSupabaseConnection();
        if (!connectionOk) {
            throw new Error('Database connection failed');
        }
        
        console.log('🔄 Attempting login with:', email);
        
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            console.error('❌ Login error details:', {
                message: error.message,
                name: error.name,
                stack: error.stack
            });
            throw error;
        }

        console.log('✅ Login successful for:', data.user.email);
        return data;
        
    } catch (error) {
        console.error('💥 Emergency login failed:', error);
        throw error;
    }
}

// Update order statistics
function updateOrderStats(orders) {
    const completedOrders = orders.filter(order => order.status === 'completed');
    const pendingOrders = orders.filter(order => order.status === 'pending');
    const totalRevenue = completedOrders.reduce((sum, order) => sum + (parseFloat(order.total_amount) || 0), 0);

    // Update the stats display
    document.getElementById('totalOrders').textContent = orders.length;
    document.getElementById('totalRevenue').textContent = `₦${totalRevenue.toLocaleString()}`;
    
    // Update the additional stats if they exist
    const completedElement = document.querySelector('.stat:nth-child(3) .stat-value');
    const pendingElement = document.querySelector('.stat:nth-child(4) .stat-value');
    
    if (completedElement) completedElement.textContent = completedOrders.length;
    if (pendingElement) pendingElement.textContent = pendingOrders.length;
}

async function loadOrders() {
    try {
        console.log('📥 Loading orders...');
        const ordersTable = document.getElementById('ordersTable');
        
        if (!ordersTable) {
            console.error('❌ Orders table element not found');
            return;
        }

        ordersTable.innerHTML = '<div class="loading">Loading orders...</div>';

        if (!currentCompany) {
            console.error('❌ No company data');
            ordersTable.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🧾</div>
                    <h3>No restaurant data</h3>
                    <p>Please login again</p>
                </div>
            `;
            return;
        }

        console.log('🔍 Loading orders for company:', currentCompany.id);
        
        const { data: orders, error } = await supabase
            .from('orders')
            .select('*')
            .eq('company_id', currentCompany.id)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('❌ Orders query error:', error);
            throw error;
        }

        console.log('✅ Orders loaded:', orders?.length || 0);
        
        if (!orders || orders.length === 0) {
            ordersTable.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🧾</div>
                    <h3>No orders yet</h3>
                    <p>Orders will appear here when customers place them</p>
                </div>
            `;
            return;
        }

        displayOrders(orders);
        
    } catch (error) {
        console.error('❌ Error loading orders:', error);
        const ordersTable = document.getElementById('ordersTable');
        if (ordersTable) {
            ordersTable.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">❌</div>
                    <h3>Error loading orders</h3>
                    <p>Please try refreshing the page</p>
                    <button class="btn btn-primary" onclick="loadOrders()">Retry</button>
                </div>
            `;
        }
    }
}

function displayOrders(orders) {
    const ordersTable = document.getElementById('ordersTable');
    if (!ordersTable) return;

    // Check if we're on mobile
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
        // Mobile-optimized display
        displayOrdersMobile(orders, ordersTable);
    } else {
        // Desktop display
        displayOrdersDesktop(orders, ordersTable);
    }
}

function displayOrdersMobile(orders, ordersTable) {
    if (!orders || orders.length === 0) {
        ordersTable.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🧾</div>
                <h3>No orders yet</h3>
                <p>Orders will appear here when customers place them</p>
            </div>
        `;
        return;
    }

    let html = '<div class="orders-list-mobile">';
    
    orders.forEach(order => {
        const shortId = order.id ? order.id.slice(-8) : 'N/A';
        const orderDate = order.created_at ? new Date(order.created_at) : new Date();
        const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
        const locationType = order.location_type || 'table';
        const locationNumber = order.location_number || order.table_number || 'N/A';
        
        html += `
            <div class="table-row" data-order-id="${order.id}">
                <div data-label="Order ID"><strong>#${shortId}</strong></div>
                <div data-label="Customer">
                    <div style="font-weight: 600;">${order.customer_name || 'Guest'}</div>
                    ${order.customer_phone ? `<div style="font-size: 13px; color: var(--text-muted); margin-top: 2px;">${order.customer_phone}</div>` : ''}
                    <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
                        ${locationType === 'room' ? '🏨 Room' : '🍽️ Table'} ${locationNumber}
                    </div>
                </div>
                <div data-label="Items">
                    <span style="font-weight: 600;">${items.length} item${items.length !== 1 ? 's' : ''}</span>
                    ${items.length > 0 ? `<div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">${items[0].name}${items.length > 1 ? ` +${items.length - 1} more` : ''}</div>` : ''}
                </div>
                <div data-label="Amount"><strong style="color: var(--primary);">₦${parseFloat(order.total_amount || 0).toLocaleString()}</strong></div>
                <div data-label="Status">
                    <span class="status-badge status-${order.status}">${order.status}</span>
                </div>
                <div data-label="Date">
                    <div>${orderDate.toLocaleDateString()}</div>
                    <small style="color: var(--text-muted); font-size: 11px;">${orderDate.toLocaleTimeString()}</small>
                </div>
                <div data-label="Actions" class="action-buttons">
                    <button class="btn btn-outline btn-sm mobile-order-btn order-view-btn" data-order-id="${order.id}">
                        <span class="mobile-icon">👁️</span>
                        <span class="mobile-text">Details</span>
                    </button>
                    ${order.status === 'pending' ? `
                        <button class="btn btn-success btn-sm mobile-order-btn order-complete-btn" data-order-id="${order.id}">
                            <span class="mobile-icon">✅</span>
                            <span class="mobile-text">Complete</span>
                        </button>
                        <button class="btn btn-danger btn-sm mobile-order-btn order-cancel-btn" data-order-id="${order.id}">
                            <span class="mobile-icon">❌</span>
                            <span class="mobile-text">Cancel</span>
                        </button>
                    ` : `
                        <span class="status-finalized">${order.status === 'completed' ? '✅ Completed' : '❌ Cancelled'}</span>
                    `}
                </div>
            </div>
        `;
    });

    html += '</div>';
    ordersTable.innerHTML = html;
    
    // Add event listeners for order actions
    setTimeout(() => {
        setupOrderEventListeners();
    }, 100);
    
    console.log('✅ Orders displayed (mobile):', orders.length);
}

function displayOrdersMobile(orders, ordersTable) {
    if (!orders || orders.length === 0) {
        ordersTable.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🧾</div>
                <h3>No orders yet</h3>
                <p>Orders will appear here when customers place them</p>
            </div>
        `;
        return;
    }

    let html = '<div class="orders-list-mobile">';
    
    orders.forEach(order => {
        const shortId = order.id ? order.id.slice(-8) : 'N/A';
        const orderDate = order.created_at ? new Date(order.created_at) : new Date();
        const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
        const locationType = order.location_type || 'table';
        const locationNumber = order.location_number || order.table_number || 'N/A';
        
        html += `
            <div class="table-row" data-order-id="${order.id}">
                <div data-label="Order ID"><strong>#${shortId}</strong></div>
                <div data-label="Customer">
                    <div style="font-weight: 600;">${order.customer_name || 'Guest'}</div>
                    ${order.customer_phone ? `<div style="font-size: 13px; color: var(--text-muted); margin-top: 2px;">${order.customer_phone}</div>` : ''}
                    <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
                        ${locationType === 'room' ? '🏨 Room' : '🍽️ Table'} ${locationNumber}
                    </div>
                </div>
                <div data-label="Items">
                    <span style="font-weight: 600;">${items.length} item${items.length !== 1 ? 's' : ''}</span>
                    ${items.length > 0 ? `<div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">${items[0].name}${items.length > 1 ? ` +${items.length - 1} more` : ''}</div>` : ''}
                </div>
                <div data-label="Amount"><strong style="color: var(--primary);">₦${parseFloat(order.total_amount || 0).toLocaleString()}</strong></div>
                <div data-label="Status">
                    <span class="status-badge status-${order.status}">${order.status}</span>
                </div>
                <div data-label="Date">
                    <div>${orderDate.toLocaleDateString()}</div>
                    <small style="color: var(--text-muted); font-size: 11px;">${orderDate.toLocaleTimeString()}</small>
                </div>
                <div data-label="Actions" class="action-buttons">
                    <button class="btn btn-outline btn-sm mobile-order-btn" onclick="viewOrderDetails('${order.id}')">
                        <span class="mobile-icon">👁️</span>
                        <span class="mobile-text">Details</span>
                    </button>
                    ${order.status === 'pending' ? `
                        <button class="btn btn-success btn-sm mobile-order-btn" onclick="handleOrderAction('${order.id}', 'completed')">
                            <span class="mobile-icon">✅</span>
                            <span class="mobile-text">Complete</span>
                        </button>
                        <button class="btn btn-danger btn-sm mobile-order-btn" onclick="handleOrderAction('${order.id}', 'cancelled')">
                            <span class="mobile-icon">❌</span>
                            <span class="mobile-text">Cancel</span>
                        </button>
                    ` : `
                        <span class="status-finalized">${order.status === 'completed' ? '✅ Completed' : '❌ Cancelled'}</span>
                    `}
                </div>
            </div>
        `;
    });

    html += '</div>';
    ordersTable.innerHTML = html;
    
    console.log('✅ Orders displayed (mobile):', orders.length);
}

function displayOrdersDesktop(orders, ordersTable) {
    // Your original desktop code here
    let html = `
        <div class="table-container">
            <div class="table-header">
                <div>Order ID</div>
                <div>Customer</div>
                <div>Items</div>
                <div>Amount</div>
                <div>Status</div>
                <div>Date</div>
                <div>Actions</div>
            </div>
    `;

    orders.forEach(order => {
        const shortId = order.id ? order.id.slice(-8) : 'N/A';
        const orderDate = order.created_at ? new Date(order.created_at) : new Date();
        const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
        
        html += `
            <div class="table-row" data-order-id="${order.id}">
                <div data-label="Order ID"><strong>#${shortId}</strong></div>
                <div data-label="Customer">
                    <div>${order.customer_name || 'Guest'}</div>
                    ${order.customer_phone ? `<div style="font-size: 12px; color: var(--text-muted);">${order.customer_phone}</div>` : ''}
                </div>
                <div data-label="Items">${items.length} items</div>
                <div data-label="Amount"><strong>₦${parseFloat(order.total_amount || 0).toLocaleString()}</strong></div>
                <div data-label="Status">
                    <span class="status-badge status-${order.status}">${order.status}</span>
                </div>
                <div data-label="Date">
                    ${orderDate.toLocaleDateString()}<br>
                    <small style="color: var(--text-muted); font-size: 11px;">${orderDate.toLocaleTimeString()}</small>
                </div>
                <div data-label="Actions" class="action-buttons">
                    <button class="btn btn-outline btn-sm" onclick="viewOrderDetails('${order.id}')">
                        View
                    </button>
                    ${order.status === 'pending' ? `
                        <button class="btn btn-success btn-sm" onclick="handleOrderAction('${order.id}', 'completed')">
                            Complete
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="handleOrderAction('${order.id}', 'cancelled')">
                            Cancel
                        </button>
                    ` : `
                        <span class="status-finalized">${order.status === 'completed' ? '✅ Completed' : '❌ Cancelled'}</span>
                    `}
                </div>
            </div>
        `;
    });

    html += '</div>';
    ordersTable.innerHTML = html;
    
    console.log('✅ Orders displayed (desktop):', orders.length);
}

// Setup order event listeners
function setupOrderEventListeners() {
    // View order details
    document.querySelectorAll('.order-view-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const orderId = this.getAttribute('data-order-id');
            console.log('View order clicked:', orderId);
            viewOrderDetails(orderId);
        });
    });
    
    // Complete order
    document.querySelectorAll('.order-complete-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const orderId = this.getAttribute('data-order-id');
            console.log('Complete order clicked:', orderId);
            handleOrderAction(orderId, 'completed');
        });
    });
    
    // Cancel order
    document.querySelectorAll('.order-cancel-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const orderId = this.getAttribute('data-order-id');
            console.log('Cancel order clicked:', orderId);
            handleOrderAction(orderId, 'cancelled');
        });
    });
}

// Custom Card Input Functions
function openCardInputModal() {
    console.log('💳 Opening card input modal...');
    const modal = document.getElementById('cardInputModal');
    if (!modal) {
        console.error('❌ Card input modal not found');
        return;
    }
    
    // Close any other open modals first
    closeAllModals();
    
    // Show this modal
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    
    // Mobile-specific positioning
    if (window.innerWidth <= 768) {
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.padding = '20px 10px';
    }
    
    setupCardPreview();
    console.log('✅ Card input modal opened');
}

function closeCardInputModal() {
    console.log('🔒 Closing card input modal...');
    
    const modal = document.getElementById('cardInputModal');
    if (!modal) {
        console.log('❌ Modal not found');
        return;
    }
    
    // Use multiple methods to ensure it closes on mobile
    modal.classList.add('hidden');
    modal.style.display = 'none';
    modal.style.visibility = 'hidden';
    modal.style.opacity = '0';
    
    // Remove any active classes
    modal.classList.remove('show', 'active');
    
    // Handle mobile viewport specifically
    if (window.innerWidth <= 768) {
        // Reset any transform that might be keeping it visible
        modal.style.transform = 'translateY(100%)';
        
        // Force a reflow
        void modal.offsetHeight;
    }

    
    
    // Remove backdrop if exists
    const backdrop = document.querySelector('.modal-backdrop');
    if (backdrop) {
        backdrop.style.display = 'none';
        backdrop.remove();
    }
    
    // Reset body
    document.body.style.overflow = 'auto';
    document.body.classList.remove('modal-open');
    
    // Remove any inline styles that might be causing issues
    document.body.style.removeProperty('padding-right');
    
    console.log('✅ Card input modal closed');
}


function closeAllModals(exceptId = null) {
    const modals = document.querySelectorAll('.modal-overlay');

    modals.forEach(modal => {
        if (modal.id === exceptId) return;

        // skip auth-related modals
        if (modal.id.includes('auth') || modal.id.includes('login') || modal.id.includes('signup')) {
            return;
        }

        modal.classList.add('hidden');
        modal.style.display = 'none';
    });

    document.body.style.overflow = '';
}


function resetCardPreview() {
    const cardNumberPreview = document.querySelector('.card-number-preview');
    const cardExpiryPreview = document.querySelector('.card-expiry-preview');
    const cardNamePreview = document.querySelector('.card-name-preview');
    
    if (cardNumberPreview) cardNumberPreview.textContent = '•••• •••• •••• ••••';
    if (cardExpiryPreview) cardExpiryPreview.textContent = 'MM/YY';
    if (cardNamePreview) cardNamePreview.textContent = 'FULL NAME';
}

function setupCardPreview() {
  const cardNumberInput = document.getElementById('customCardNumber');
  const expiryInput = document.getElementById('customExpiryDate');
  const nameInput = document.getElementById('customCardName');
  
  if (cardNumberInput) {
    cardNumberInput.addEventListener('input', function(e) {
      let value = e.target.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
      let formattedValue = value.match(/.{1,4}/g)?.join(' ');
      e.target.value = formattedValue || value;
      
      // Update preview
      const preview = document.querySelector('.card-number-preview');
      if (preview) {
        preview.textContent = formattedValue || '•••• •••• •••• ••••';
      }
    });
  }
  
  if (expiryInput) {
    expiryInput.addEventListener('input', function(e) {
      let value = e.target.value.replace(/[^0-9]/g, '');
      if (value.length >= 2) {
        value = value.substring(0, 2) + '/' + value.substring(2, 4);
      }
      e.target.value = value;
      
      // Update preview
      const preview = document.querySelector('.card-expiry-preview');
      if (preview) {
        preview.textContent = value || 'MM/YY';
      }
    });
  }
  
  if (nameInput) {
    nameInput.addEventListener('input', function(e) {
      const preview = document.querySelector('.card-name-preview');
      if (preview) {
        preview.textContent = e.target.value.toUpperCase() || 'FULL NAME';
      }
    });
  }
}

// Emergency close function for mobile
function emergencyCloseModals() {
    console.log('🚨 EMERGENCY CLOSE ALL MODALS');
    const modals = document.querySelectorAll('.modal-overlay');
    let closedCount = 0;
    
    modals.forEach(modal => {
        if (!modal.classList.contains('hidden')) {
            modal.classList.add('hidden');
            closedCount++;
        }
    });
    
    document.body.style.overflow = '';
    document.body.style.position = '';
    
    console.log(`✅ Closed ${closedCount} modals`);
    showToast('All modals closed', 'info');
}

// Make it available globally
window.emergencyCloseModals = emergencyCloseModals;

// Update subscription form to use custom card input
function setupSubscriptionCardInput() {
  const cardNumberInput = document.getElementById('cardNumber');
  if (cardNumberInput) {
    cardNumberInput.addEventListener('focus', function(e) {
      e.preventDefault();
      closeModal('subscriptionModal');
      setTimeout(() => {
        openCardInputModal();
      }, 300);
    });
  }
}

// Add this function to debug order issues
async function debugOrders() {
    console.log('🔍 DEBUG: Checking orders setup...');
    
    if (!currentCompany) {
        console.error('❌ No company data');
        return;
    }

    try {
        // Test orders query
        const { data: orders, error } = await supabase
            .from('orders')
            .select('*')
            .eq('company_id', currentCompany.id)
            .order('created_at', { ascending: false })
            .limit(5);

        if (error) {
            console.error('❌ Orders query failed:', error);
            return;
        }

        console.log('✅ Orders found:', orders?.length || 0);
        console.log('Sample order:', orders?.[0]);
        
        // Test if buttons work
        if (orders && orders.length > 0) {
            console.log('🎯 Testing button functionality for order:', orders[0].id);
        }
        
    } catch (error) {
        console.error('❌ Debug failed:', error);
    }
}

// Call this in browser console: debugOrders()

// Add this function to debug orders loading
async function debugOrdersLoading() {
    try {
        console.log('🔍 DEBUG: Checking orders setup...');
        
        if (!currentCompany) {
            console.error('❌ No company data');
            return;
        }

        console.log('🔍 Company ID:', currentCompany.id);
        
        // Test if orders table exists
        const { data: testOrders, error: testError } = await supabase
            .from('orders')
            .select('id')
            .limit(1);

        if (testError) {
            console.error('❌ Orders table error:', testError);
            return;
        }

        console.log('✅ Orders table exists, sample:', testOrders);
        
        // Load actual orders
        const { data: orders, error } = await supabase
            .from('orders')
            .select('*')
            .eq('company_id', currentCompany.id)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('❌ Orders query error:', error);
            return;
        }

        console.log('📊 Orders found:', orders?.length || 0);
        console.log('Sample order:', orders?.[0]);
        
        return orders;
        
    } catch (error) {
        console.error('❌ Debug failed:', error);
    }
}

async function viewOrderDetails(orderId) {
    try {
        console.log('🔍 Loading order details for:', orderId);
        
        const { data: order, error } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();

        if (error) {
            console.error('❌ Error loading order details:', error);
            showToast('Error loading order details', 'error');
            return;
        }

        if (!order) {
            showToast('Order not found', 'error');
            return;
        }

        showOrderDetailsModal(order);
        
    } catch (error) {
        console.error('❌ Error loading order details:', error);
        showToast('Error loading order details', 'error');
    }
}

function showOrderDetailsModal(order) {
    let items = [];
    try {
        items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
    } catch (e) {
        console.error('Error parsing order items:', e);
        items = [];
    }

    const locationType = order.location_type || 'table';
    const locationNumber = order.location_number || order.table_number || 'N/A';
    const locationLabel = locationType === 'room' ? 'Room Number' : 'Table Number';

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal modal-lg">
            <div class="modal-header">
                <h3>Order Details - #${order.id.slice(-8)}</h3>
                <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            <div class="modal-body">
                <div class="order-details-grid">
                    <div class="detail-group">
                        <h4>Customer Information</h4>
                        <div class="detail-item">
                            <label>Name:</label>
                            <span>${order.customer_name || 'N/A'}</span>
                        </div>
                        <div class="detail-item">
                            <label>Phone:</label>
                            <span>${order.customer_phone || 'Not provided'}</span>
                        </div>
                        <div class="detail-item">
                            <label>Order Type:</label>
                            <span>${order.order_type || 'N/A'}</span>
                        </div>
                        <div class="detail-item">
                            <label>Location:</label>
                            <span>${locationType === 'room' ? '🏨 Hotel Room' : '🍽️ Restaurant Table'} ${locationNumber}</span>
                        </div>
                    </div>
                    
                    <div class="detail-group">
                        <h4>Order Information</h4>
                        <div class="detail-item">
                            <label>Status:</label>
                            <span class="status-badge status-${order.status}">${order.status}</span>
                        </div>
                        <div class="detail-item">
                            <label>Payment Method:</label>
                            <span>${order.payment_method || 'N/A'}</span>
                        </div>
                        <div class="detail-item">
                            <label>Total Amount:</label>
                            <span class="price">₦${parseFloat(order.total_amount || 0).toLocaleString()}</span>
                        </div>
                        <div class="detail-item">
                            <label>Order Date:</label>
                            <span>${new Date(order.created_at).toLocaleString()}</span>
                        </div>
                    </div>
                </div>
                
                <div class="order-items">
                    <h4>Order Items (${items.length})</h4>
                    <div class="items-list">
                        ${items.length > 0 ? items.map(item => `
                            <div class="order-item">
                                <div class="item-info">
                                    <div class="item-name">${item.name || 'Unknown Item'}</div>
                                    <div class="item-quantity">Quantity: ${item.quantity || 1}</div>
                                </div>
                                <div class="item-price">
                                    ₦${parseFloat(item.unit_price || item.price || 0).toLocaleString()} × ${item.quantity || 1} = ₦${((parseFloat(item.unit_price || item.price || 0)) * (item.quantity || 1)).toLocaleString()}
                                </div>
                            </div>
                        `).join('') : '<p class="no-items">No items found</p>'}
                    </div>
                    
                    <div class="order-summary">
                        <div class="summary-total">
                            <strong>Total: ₦${parseFloat(order.total_amount || 0).toLocaleString()}</strong>
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                ${order.status === 'pending' ? `
                    <button class="btn btn-success" onclick="handleOrderAction('${order.id}', 'completed'); this.closest('.modal-overlay').remove()">
                        Mark as Completed
                    </button>
                    <button class="btn btn-danger" onclick="handleOrderAction('${order.id}', 'cancelled'); this.closest('.modal-overlay').remove()">
                        Cancel Order
                    </button>
                ` : `
                    <span class="status-finalized-text">This order has been ${order.status}</span>
                `}
                <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// ==============================================
// EXPORT ORDER FUNCTIONS
// ==============================================
function openExportModal() {
    const modal = document.getElementById('exportModal');
    if (!modal) {
        console.error('Export modal not found');
        return;
    }
    
    // Set default dates (last 30 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    
    document.getElementById('exportStartDate').value = startDate.toISOString().split('T')[0];
    document.getElementById('exportEndDate').value = endDate.toISOString().split('T')[0];
    
    // Load preview stats
    updateExportPreview();
    
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

// Close Export Modal
function closeExportModal() {
    const modal = document.getElementById('exportModal');
    if (modal) {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
    }
}

// Set Quick Date Ranges
function setExportDateRange(range) {
    const today = new Date();
    const startDateInput = document.getElementById('exportStartDate');
    const endDateInput = document.getElementById('exportEndDate');
    
    switch(range) {
        case 'today':
            const todayStr = today.toISOString().split('T')[0];
            startDateInput.value = todayStr;
            endDateInput.value = todayStr;
            break;
            
        case 'week':
            const startOfWeek = new Date(today);
            startOfWeek.setDate(today.getDate() - today.getDay());
            startDateInput.value = startOfWeek.toISOString().split('T')[0];
            endDateInput.value = today.toISOString().split('T')[0];
            break;
            
        case 'month':
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            startDateInput.value = startOfMonth.toISOString().split('T')[0];
            endDateInput.value = today.toISOString().split('T')[0];
            break;
            
        case 'all':
            startDateInput.value = '';
            endDateInput.value = '';
            break;
    }
    
    updateExportPreview();
}

// Update Export Preview Stats
async function updateExportPreview() {
    try {
        const exportStats = document.getElementById('exportStats');
        if (!exportStats) {
            console.error('Export stats element not found');
            return;
        }

        if (!currentCompany) {
            exportStats.innerHTML = '<div class="error">Please login first</div>';
            return;
        }

        const startDate = document.getElementById('exportStartDate')?.value || '';
        const endDate = document.getElementById('exportEndDate')?.value || '';
        
        exportStats.innerHTML = '<div class="loading">Loading statistics...</div>';
        
        let query = supabase
            .from('orders')
            .select('*')
            .eq('company_id', currentCompany.id)
            .order('created_at', { ascending: false });
        
        // Apply date filters if provided
        if (startDate) {
            query = query.gte('created_at', `${startDate}T00:00:00Z`);
        }
        if (endDate) {
            query = query.lte('created_at', `${endDate}T23:59:59Z`);
        }
        
        const { data: orders, error } = await query;
        
        if (error) {
            console.error('Error loading orders for export:', error);
            exportStats.innerHTML = '<div class="error">Error loading orders</div>';
            return;
        }
        
        // Initialize currentExportOrders
        currentExportOrders = orders || [];
        displayExportStats(currentExportOrders);
        
    } catch (error) {
        console.error('Error loading export stats:', error);
        const exportStats = document.getElementById('exportStats');
        if (exportStats) {
            exportStats.innerHTML = '<div class="error">Error loading statistics</div>';
        }
    }
}

// Display Export Statistics
function displayExportStats(orders) {
    const stats = calculateExportStats(orders);
    const statsElement = document.getElementById('exportStats');
    
    statsElement.innerHTML = `
        <div class="stats-grid-export">
            <div class="stat-card">
                <div class="stat-value total">${stats.totalOrders}</div>
                <div class="stat-label">Total Orders</div>
            </div>
            <div class="stat-card">
                <div class="stat-value completed">${stats.completedOrders}</div>
                <div class="stat-label">Completed</div>
            </div>
            <div class="stat-card">
                <div class="stat-value pending">${stats.pendingOrders}</div>
                <div class="stat-label">Pending</div>
            </div>
            <div class="stat-card">
                <div class="stat-value cancelled">${stats.cancelledOrders}</div>
                <div class="stat-label">Cancelled</div>
            </div>
        </div>
        
        <div class="export-summary">
            <div class="summary-item">
                <span>Total Revenue:</span>
                <strong class="stat-value revenue">₦${stats.totalRevenue.toLocaleString()}</strong>
            </div>
            <div class="summary-item">
                <span>Average Order Value:</span>
                <span>₦${stats.averageOrderValue.toLocaleString()}</span>
            </div>
            <div class="summary-item">
                <span>Completion Rate:</span>
                <span>${stats.completionRate}%</span>
            </div>
            <div class="summary-item">
                <span>Period:</span>
                <span>${stats.period}</span>
            </div>
        </div>
    `;
}

// Enhanced calculateExportStats function
function calculateExportStats(orders) {
    const completedOrders = orders.filter(order => order.status === 'completed');
    const pendingOrders = orders.filter(order => order.status === 'pending');
    const cancelledOrders = orders.filter(order => order.status === 'cancelled');
    
    const totalRevenue = completedOrders.reduce((sum, order) => sum + (parseFloat(order.total_amount) || 0), 0);
    const averageOrderValue = completedOrders.length > 0 ? totalRevenue / completedOrders.length : 0;
    const completionRate = orders.length > 0 ? ((completedOrders.length / orders.length) * 100).toFixed(1) : 0;
    
    // Get date inputs
    const startDateInput = document.getElementById('exportStartDate');
    const endDateInput = document.getElementById('exportEndDate');
    const startDate = startDateInput ? startDateInput.value : '';
    const endDate = endDateInput ? endDateInput.value : '';
    
    // Format dates for display
    const formatDateForDisplay = (dateString) => {
        if (!dateString) return 'Not set';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        });
    };
    
    // Determine period string
    let period = 'All Time';
    if (startDate && endDate) {
        period = `${formatDateForDisplay(startDate)} to ${formatDateForDisplay(endDate)}`;
    } else if (startDate) {
        period = `From ${formatDateForDisplay(startDate)}`;
    } else if (endDate) {
        period = `Until ${formatDateForDisplay(endDate)}`;
    }
    
    return {
        totalOrders: orders.length,
        completedOrders: completedOrders.length,
        pendingOrders: pendingOrders.length,
        cancelledOrders: cancelledOrders.length,
        totalRevenue: totalRevenue,
        averageOrderValue: averageOrderValue,
        completionRate: completionRate,
        startDate: formatDateForDisplay(startDate),
        endDate: formatDateForDisplay(endDate),
        period: period
    };
}

// Enhanced generateProfessionalExport with better error handling
async function generateProfessionalExport() {
    try {
        console.log('📊 Starting export process...');
        
        if (!currentCompany) {
            showToast('Please login first', 'error');
            return;
        }

        if (!currentExportOrders || currentExportOrders.length === 0) {
            showToast('No orders found for the selected period', 'info');
            return;
        }

        showLoading('Generating professional report...');

        // Generate CSV content
        const csvContent = generateProfessionalCSV(currentExportOrders);
        
        // Create filename
        const startDate = document.getElementById('exportStartDate')?.value || '';
        const endDate = document.getElementById('exportEndDate')?.value || '';
        
        let filename = `${currentCompany.name.replace(/[^a-z0-9]/gi, '_')}_Orders_Report`;
        
        if (startDate && endDate) {
            filename += `_${startDate.replace(/-/g, '')}_to_${endDate.replace(/-/g, '')}`;
        } else if (startDate) {
            filename += `_from_${startDate.replace(/-/g, '')}`;
        } else if (endDate) {
            filename += `_until_${endDate.replace(/-/g, '')}`;
        } else {
            filename += '_all_time';
        }
        filename += '.csv';
        
        // Download file
        downloadCSV(csvContent, filename);
        
        console.log('✅ Export completed successfully');
        showToast(`📊 Report exported with ${currentExportOrders.length} orders!`, 'success');
        
        // Close modal after short delay
        setTimeout(() => {
            closeExportModal();
        }, 1000);
        
    } catch (error) {
        console.error('❌ Export error:', error);
        showToast('Error generating report: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Generate Professional CSV Export
function generateProfessionalCSV(orders) {
    const completedOrders = orders.filter(order => order.status === 'completed');
    const stats = calculateExportStats(orders);
    
    let csv = '';
    
    // ===== HEADER WITH COMPANY INFO =====
    csv += `"${currentCompany.name}"\n`;
    csv += `"Orders Export Report"\n`;
    csv += `"Generated on: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}"\n`;
    csv += `"Period: ${stats.period}"\n`;
    csv += '\n';
    
    // ===== SUMMARY SECTION =====
    csv += '"SUMMARY STATISTICS"\n';
    csv += '"Metric","Value"\n';
    csv += `"Total Orders","${stats.totalOrders}"\n`;
    csv += `"Completed Orders","${stats.completedOrders}"\n`;
    csv += `"Pending Orders","${stats.pendingOrders}"\n`;
    csv += `"Cancelled Orders","${stats.cancelledOrders}"\n`;
    csv += `"Completion Rate","${stats.completionRate}%"\n`;
    csv += `"Total Revenue","₦${stats.totalRevenue.toLocaleString()}"\n`;
    csv += `"Average Order Value","₦${stats.averageOrderValue.toLocaleString()}"\n`;
    csv += '\n\n';
    
    // ===== DETAILED ORDERS =====
    csv += '"DETAILED ORDERS"\n';
    
    // Headers
    const headers = [
        'Order ID',
        'Date & Time',
        'Customer Name',
        'Customer Phone',
        'Order Type',
        'Location',
        'Payment Method',
        'Status',
        'Items Count',
        'Total Amount (₦)'
    ];
    csv += headers.map(header => `"${header}"`).join(',') + '\n';
    
    // Order data
    orders.forEach(order => {
        const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
        const locationType = order.location_type || 'table';
        const locationNumber = order.location_number || order.table_number || 'N/A';
        const location = `${locationType === 'room' ? 'Room' : 'Table'} ${locationNumber}`;
        
        const row = [
            `"${order.id.slice(-8)}"`, // Short order ID
            `"${new Date(order.created_at).toLocaleString()}"`,
            `"${order.customer_name || 'Guest'}"`,
            `"${order.customer_phone || 'N/A'}"`,
            `"${order.order_type || 'N/A'}"`,
            `"${location}"`,
            `"${order.payment_method || 'N/A'}"`,
            `"${order.status.toUpperCase()}"`,
            `"${items ? items.length : 0}"`,
            `"${parseFloat(order.total_amount || 0).toLocaleString()}"`
        ];
        csv += row.join(',') + '\n';
    });
    
    csv += '\n\n';
    
    // ===== REVENUE SUMMARY =====
    csv += '"REVENUE SUMMARY (COMPLETED ORDERS ONLY)"\n';
    csv += '"Description","Value"\n';
    csv += `"Total Revenue","₦${stats.totalRevenue.toLocaleString()}"\n`;
    csv += `"Number of Completed Orders","${completedOrders.length}"\n`;
    csv += `"Average Order Value","₦${stats.averageOrderValue.toLocaleString()}"\n`;
    csv += `"Highest Order Value","₦${Math.max(...completedOrders.map(o => parseFloat(o.total_amount || 0))).toLocaleString()}"\n`;
    csv += `"Lowest Order Value","₦${Math.min(...completedOrders.map(o => parseFloat(o.total_amount || 0))).toLocaleString()}"\n`;
    
    return csv;
}

// Download CSV File
function downloadCSV(csvContent, filename) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Make functions globally available
window.openExportModal = openExportModal;
window.closeExportModal = closeExportModal;
window.setExportDateRange = setExportDateRange;
window.updateExportPreview = updateExportPreview;
window.generateProfessionalExport = generateProfessionalExport;

async function handleOrderAction(orderId, newStatus) {
    console.log(`🎯 ORDER ACTION: ${orderId} -> ${newStatus}`);
    
    try {
        // Show immediate loading state
        const orderRow = document.querySelector(`[data-order-id="${orderId}"]`);
        if (!orderRow) {
            console.error('❌ Order row not found');
            return;
        }

        const actionButtons = orderRow.querySelector('.action-buttons');
        if (actionButtons) {
            actionButtons.innerHTML = '<div class="loading-text">🔄 Updating...</div>';
        }

        console.log(`📤 Updating order in Supabase: ${orderId} -> ${newStatus}`);

        const updateData = { 
            status: newStatus,
            updated_at: new Date().toISOString()
        };

        // ✅ Set appropriate timestamp based on status
        if (newStatus === 'completed') {
            updateData.completed_at = new Date().toISOString();
            // Clear cancelled_at if it was previously set
            updateData.cancelled_at = null;
        } else if (newStatus === 'cancelled') {
            updateData.cancelled_at = new Date().toISOString();
            // Clear completed_at if it was previously set
            updateData.completed_at = null;
        } else if (newStatus === 'pending') {
            // Reset both timestamps if going back to pending
            updateData.completed_at = null;
            updateData.cancelled_at = null;
        }

        const { data, error } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', orderId)
            .select();

        if (error) {
            console.error('❌ Supabase update error:', error);
            throw error;
        }

        console.log(`✅ Order updated in Supabase:`, data[0]);

        // ✅ IMMEDIATE UI UPDATE
        updateOrderUI(orderRow, newStatus);
        
        showToast(`Order marked as ${newStatus}!`, 'success');

        // Refresh the orders list after a short delay
        setTimeout(() => {
            loadOrders();
        }, 1000);

    } catch (error) {
        console.error('❌ Order update failed:', error);
        showToast('Failed to update order: ' + error.message, 'error');
        
        // Restore buttons on error
        restoreOrderButtons(orderId);
    }
}

// Test backend endpoint directly
async function testBackendEndpoint() {
    try {
        const backendUrl = window.location.origin.includes('localhost') 
            ? 'http://localhost:5000' 
            : window.location.origin;

        console.log('🧪 Testing backend endpoint directly...');
        
        // First, get a real order ID
        const ordersTable = document.getElementById('ordersTable');
        if (!ordersTable) {
            console.log('No orders table found');
            return;
        }

        const firstOrderRow = ordersTable.querySelector('[data-order-id]');
        if (!firstOrderRow) {
            console.log('No orders found to test');
            return;
        }

        const orderId = firstOrderRow.getAttribute('data-order-id');
        console.log('🔑 Testing with order ID:', orderId);

        // Test 1: Check if endpoint exists
        console.log('1. Testing endpoint existence...');
        const testResponse = await fetch(`${backendUrl}/api/orders/${orderId}/status`, {
            method: 'OPTIONS' // Use OPTIONS to check allowed methods
        });
        console.log('Endpoint options:', testResponse.status, testResponse.headers.get('allow'));

        // Test 2: Try PATCH request
        console.log('2. Testing PATCH request...');
        const patchResponse = await fetch(`${backendUrl}/api/orders/${orderId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ status: 'completed' })
        });

        console.log('PATCH Response:', patchResponse.status, patchResponse.statusText);
        
        if (patchResponse.ok) {
            const result = await patchResponse.json();
            console.log('✅ PATCH successful:', result);
            showToast('Backend test successful!', 'success');
        } else {
            const errorText = await patchResponse.text();
            console.error('❌ PATCH failed:', errorText);
            showToast('Backend test failed: ' + errorText, 'error');
        }

    } catch (error) {
        console.error('❌ Backend test failed:', error);
        showToast('Backend test error: ' + error.message, 'error');
    }
}

// Make it globally available
window.testBackendEndpoint = testBackendEndpoint;

// Test function to verify backend connection
async function testBackendOrderUpdate() {
    try {
        const ordersTable = document.getElementById('ordersTable');
        if (!ordersTable) {
            console.log('No orders table found');
            return;
        }

        const firstOrderRow = ordersTable.querySelector('[data-order-id]');
        if (!firstOrderRow) {
            console.log('No orders found to test');
            return;
        }

        const orderId = firstOrderRow.getAttribute('data-order-id');
        const currentStatus = firstOrderRow.querySelector('.status-badge')?.textContent;
        
        console.log('🧪 Testing backend order update:');
        console.log('Order ID:', orderId);
        console.log('Current Status:', currentStatus);
        
        // Test the backend call directly
        const backendUrl = window.location.origin.includes('localhost') 
            ? 'http://localhost:5000' 
            : window.location.origin;

        const testResponse = await fetch(`${backendUrl}/api/orders/${currentCompany.id}`);
        console.log('Backend connection test:', testResponse.status, testResponse.statusText);
        
        if (testResponse.ok) {
            console.log('✅ Backend is accessible');
            
            // Now test the status update
            const newStatus = currentStatus === 'pending' ? 'completed' : 'pending';
            console.log(`Testing status update to: ${newStatus}`);
            
            await handleOrderAction(orderId, newStatus);
            
        } else {
            console.error('❌ Backend not accessible');
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}



document.getElementById("confirmDeleteBtn").addEventListener("click", async () => {
  if (!pendingDeleteMealId) return;

  const { error } = await supabase.from("meals").delete().eq("id", pendingDeleteMealId);

  if (error) {
    showToast("Error deleting meal", "error");
  } else {
    showToast("Meal deleted", "success");
    loadMeals();
  }

  pendingDeleteMealId = null;
  closeModal('confirmDeleteModal');
});

// Debug function to show all order IDs
function showOrderIds() {
    console.log('🔍 ALL ORDER IDs:');
    const ordersTable = document.getElementById('ordersTable');
    if (!ordersTable) {
        console.log('No orders table found');
        return;
    }}

    const orderRows = ordersTable.querySelectorAll('[data-order-id]');
    console.log(`Found ${orderRows.length} orders:`);
    
    orderRows.forEach((row, index) => {
        const orderId = row.getAttribute('data-order-id');
        const shortId = orderId ? orderId.slice(-8) : 'N/A';
        const status = row.querySelector('.status-badge')?.textContent || 'unknown';
        console.log(`${index + 1}. ${shortId} (${orderId}) - Status: ${status}`);
    });

// Test function with real order
function testWithRealOrder() {
    const ordersTable = document.getElementById('ordersTable');
    if (!ordersTable) return;
    
    const firstOrderRow = ordersTable.querySelector('[data-order-id]');
    if (firstOrderRow) {
        const realOrderId = firstOrderRow.getAttribute('data-order-id');
        console.log('🎯 REAL ORDER ID TO TEST:', realOrderId);
        return realOrderId;
    } else {
        console.log('❌ No orders found to test');
        return null;
    }
}

// Helper function to update the UI immediately
function updateOrderUI(orderRow, newStatus) {
    console.log('🎨 Updating UI for status:', newStatus);
    
    // Update status badge
    const statusBadge = orderRow.querySelector('.status-badge');
    if (statusBadge) {
        statusBadge.className = `status-badge status-${newStatus}`;
        statusBadge.textContent = newStatus;
    }

    // Update action buttons
    const actionButtons = orderRow.querySelector('.action-buttons');
    if (actionButtons) {
        if (newStatus === 'completed') {
            actionButtons.innerHTML = '<span class="status-finalized">✅ Completed</span>';
        } else if (newStatus === 'cancelled') {
            actionButtons.innerHTML = '<span class="status-finalized">❌ Cancelled</span>';
        }
        actionButtons.style.pointerEvents = 'none';
    }

    // Add finalized styling
    orderRow.classList.add('order-finalized');
    orderRow.style.opacity = '0.8';
    
    console.log('✅ UI updated successfully');
}

// Helper function to restore buttons if update fails
function restoreOrderButtons(orderId) {
    console.log('🔄 Restoring buttons for order:', orderId);
    const orderRow = document.querySelector(`[data-order-id="${orderId}"]`);
    if (orderRow) {
        const actionButtons = orderRow.querySelector('.action-buttons');
        if (actionButtons) {
            actionButtons.innerHTML = `
                <button class="btn btn-outline btn-sm" onclick="viewOrderDetails('${orderId}')">View</button>
                <button class="btn btn-success btn-sm" onclick="handleOrderAction('${orderId}', 'completed')">Complete</button>
                <button class="btn btn-danger btn-sm" onclick="handleOrderAction('${orderId}', 'cancelled')">Cancel</button>
            `;
            actionButtons.style.pointerEvents = 'auto';
            console.log('✅ Restored original buttons');
        }
    }
}

// Update stats immediately
function updateOrderStatsImmediately() {
    const orderRows = document.querySelectorAll('.table-row');
    const totalOrders = orderRows.length;
    const pendingOrders = Array.from(orderRows).filter(row => {
        const statusBadge = row.querySelector('.status-badge');
        return statusBadge && statusBadge.textContent === 'pending';
    }).length;
    
    const completedOrders = Array.from(orderRows).filter(row => {
        const statusBadge = row.querySelector('.status-badge');
        return statusBadge && statusBadge.textContent === 'completed';
    }).length;
    
    // Calculate revenue from completed orders
    let totalRevenue = 0;
    orderRows.forEach(row => {
        const statusBadge = row.querySelector('.status-badge');
        if (statusBadge && statusBadge.textContent === 'completed') {
            const amountElement = row.querySelector('strong');
            if (amountElement) {
                const amountText = amountElement.textContent.replace('₦', '').replace(/,/g, '');
                const amount = parseFloat(amountText) || 0;
                totalRevenue += amount;
            }
        }
    });
    
    // Update stats display
    document.getElementById('totalOrders').textContent = totalOrders;
    document.getElementById('totalRevenue').textContent = `₦${totalRevenue.toLocaleString()}`;
    
    console.log('📊 Updated stats - Total:', totalOrders, 'Pending:', pendingOrders, 'Revenue:', totalRevenue);
}

// Enhanced debug function to test order updates
async function debugOrderUpdate(orderId, newStatus) {
    console.log('🧪 DEBUG: Testing order update...');
    
    try {
        // Test 1: Check if order exists
        const { data: order, error: fetchError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();

        if (fetchError) {
            console.error('❌ Order fetch failed:', fetchError);
            return;
        }

        console.log('✅ Order found:', order);

        // Test 2: Try to update
        const updateData = {
            status: newStatus,
            updated_at: new Date().toISOString()
        };

        if (newStatus === 'completed') {
            updateData.completed_at = new Date().toISOString();
        }

        const { data: updatedOrder, error: updateError } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', orderId)
            .select();

        if (updateError) {
            console.error('❌ Update failed:', updateError);
            
            // Check for RLS issues
            if (updateError.code === '42501') {
                console.error('🔒 RLS POLICY BLOCKING: You need to enable RLS policies in Supabase');
                showToast('Database permissions issue. Please contact support.', 'error');
            }
            return;
        }

        console.log('✅ Update successful:', updatedOrder[0]);
        showToast('Debug: Update successful!', 'success');

        // Refresh the orders list
        loadOrders();

    } catch (error) {
        console.error('❌ Debug failed:', error);
    }
}

async function debugSupabaseConnection() {
    try {
        console.log('🔍 DEBUG: Testing Supabase connection and orders table...');
        
        // Test 1: Check if we can connect to Supabase
        console.log('1. Testing Supabase connection...');
        const { data: testData, error: testError } = await supabase
            .from('orders')
            .select('id')
            .limit(1);

        if (testError) {
            console.error('❌ Supabase connection failed:', testError);
            return;
        }
        console.log('✅ Supabase connection successful');

        // Test 2: Check orders table structure
        console.log('2. Checking orders table structure...');
        const { data: sampleOrder, error: sampleError } = await supabase
            .from('orders')
            .select('*')
            .limit(1)
            .single();

        if (sampleError) {
            console.error('❌ Cannot access orders table:', sampleError);
            return;
        }

        console.log('✅ Orders table exists');
        console.log('📊 Sample order structure:', sampleOrder);
        console.log('🔑 Order fields:', Object.keys(sampleOrder));

        // Test 3: Check if update works
        if (sampleOrder) {
            console.log('3. Testing order update...');
            const { error: updateError } = await supabase
                .from('orders')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', sampleOrder.id);

            if (updateError) {
                console.error('❌ Order update failed:', updateError);
            } else {
                console.log('✅ Order update successful');
            }
        }

    } catch (error) {
        console.error('❌ Debug failed:', error);
    }
}

// Run this in browser console: debugSupabaseConnection()

async function checkRLSPolicies() {
    try {
        console.log('🔐 Checking RLS policies...');
        
        // Try to insert a test record (will fail if RLS blocks)
        const testOrder = {
            customer_name: 'TEST CUSTOMER',
            order_type: 'dine-in',
            items: JSON.stringify([{name: 'Test', quantity: 1, price: 100}]),
            total_amount: 100,
            status: 'pending',
            created_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('orders')
            .insert([testOrder])
            .select();

        if (error) {
            console.error('❌ RLS BLOCKING WRITES:', error);
            if (error.code === '42501') {
                console.log('💡 SOLUTION: Disable RLS or add proper policies in Supabase dashboard');
            }
        } else {
            console.log('✅ RLS allows writes');
            // Clean up test record
            await supabase.from('orders').delete().eq('id', data[0].id);
        }

    } catch (error) {
        console.error('RLS check failed:', error);
    }
}

// Test your database setup
async function testDatabaseSetup() {
    console.log('🧪 Testing database setup...');
    
    try {
        // Test companies table
        const { data: companies, error: compError } = await supabase
            .from('companies')
            .select('id, name')
            .limit(1);
            
        console.log('Companies:', companies, 'Error:', compError);
        
        // Test orders table
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select('id, customer_name')
            .limit(1);
            
        console.log('Orders:', orders, 'Error:', ordersError);
        
        // Test if current company has orders
        if (currentCompany) {
            const { data: companyOrders, error: coError } = await supabase
                .from('orders')
                .select('id')
                .eq('company_id', currentCompany.id)
                .limit(1);
                
            console.log('Company orders:', companyOrders, 'Error:', coError);
        }
        
    } catch (error) {
        console.error('Database test failed:', error);
    }
}

function showOrderDetailsModal(order) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal modal-lg">
            <div class="modal-header">
                <h3>Order Details - #${order.id.slice(-8)}</h3>
                <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            <div class="modal-body">
                <div class="order-details-grid">
                    <div class="detail-group">
                        <h4>Customer Information</h4>
                        <div class="detail-item">
                            <label>Name:</label>
                            <span>${order.customer_name || 'N/A'}</span>
                        </div>
                        <div class="detail-item">
                            <label>Phone:</label>
                            <span>${order.customer_phone || 'N/A'}</span>
                        </div>
                        <div class="detail-item">
                            <label>Order Type:</label>
                            <span>${order.order_type || 'N/A'}</span>
                        </div>
                        ${order.table_number ? `
                        <div class="detail-item">
                            <label>Table Number:</label>
                            <span>${order.table_number}</span>
                        </div>
                        ` : ''}
                    </div>
                    
                    <div class="detail-group">
                        <h4>Order Information</h4>
                        <div class="detail-item">
                            <label>Status:</label>
                            <span class="status-badge status-${order.status}">${order.status}</span>
                        </div>
                        <div class="detail-item">
                            <label>Payment Method:</label>
                            <span>${order.payment_method || 'N/A'}</span>
                        </div>
                        <div class="detail-item">
                            <label>Total Amount:</label>
                            <span class="price">₦${parseFloat(order.total_amount || 0).toLocaleString()}</span>
                        </div>
                        <div class="detail-item">
                            <label>Order Date:</label>
                            <span>${new Date(order.created_at).toLocaleString()}</span>
                        </div>
                        ${order.completed_at ? `
                        <div class="detail-item">
                            <label>Completed Date:</label>
                            <span>${new Date(order.completed_at).toLocaleString()}</span>
                        </div>
                        ` : ''}
                    </div>
                </div>
                
                <div class="order-items">
                    <h4>Order Items (${order.items ? order.items.length : 0})</h4>
                    <div class="items-list">
                        ${order.items ? order.items.map(item => `
                            <div class="order-item">
                                <div class="item-info">
                                    <div class="item-name">${item.name}</div>
                                    <div class="item-quantity">Quantity: ${item.quantity}</div>
                                </div>
                                <div class="item-price">₦${parseFloat(item.unit_price || 0).toLocaleString()} × ${item.quantity} = ₦${(parseFloat(item.unit_price || 0) * item.quantity).toLocaleString()}</div>
                            </div>
                        `).join('') : '<p>No items found</p>'}
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                ${order.status === 'pending' ? `
                    <button class="btn btn-success" onclick="updateOrderStatus('${order.id}', 'completed'); this.closest('.modal-overlay').remove()">Mark as Completed</button>
                    <button class="btn btn-danger" onclick="updateOrderStatus('${order.id}', 'cancelled'); this.closest('.modal-overlay').remove()">Cancel Order</button>
                ` : `
                    <span class="status-finalized-text">This order has been ${order.status}</span>
                `}
                <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Enhanced export function with date range
async function exportOrders() {
    try {
        if (!currentCompany) {
            showToast('Please login first', 'error');
            return;
        }

        // Get all orders first to show in date modal
        const { data: allOrders, error } = await supabase
            .from('orders')
            .select('*')
            .eq('company_id', currentCompany.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!allOrders || allOrders.length === 0) {
            showToast('No orders found to export', 'info');
            return;
        }

        hideLoading();

        // Show date selection modal
        const dateRange = await showDateRangeModal(allOrders);
        if (!dateRange) return;

        showLoading('Exporting orders...');

        // Filter orders based on selected date range
        const filteredOrders = allOrders.filter(order => {
            const orderDate = new Date(order.created_at).toISOString().split('T')[0];
            let include = true;
            
            if (dateRange.startDate) {
                include = include && (orderDate >= dateRange.startDate);
            }
            if (dateRange.endDate) {
                include = include && (orderDate <= dateRange.endDate);
            }
            return include;
        });

        if (filteredOrders.length === 0) {
            showToast('No orders found for the selected period', 'info');
            return;
        }

        // Generate and download CSV
        const csvContent = generateOrdersCSV(filteredOrders);
        const filename = `orders_${dateRange.startDate || 'all'}_to_${dateRange.endDate || 'all'}.csv`;
        downloadCSV(csvContent, filename);
        
        showToast(`Exported ${filteredOrders.length} orders successfully!`, 'success');

    } catch (error) {
        console.error('Export error:', error);
        showToast('Error exporting orders: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

function generateOrdersCSV(orders) {
    const headers = ['Order ID', 'Customer Name', 'Customer Phone', 'Items Count', 'Total Amount', 'Status', 'Order Date', 'Completed Date'];
    
    // Calculate summary
    const completedOrders = orders.filter(order => order.status === 'completed');
    const totalRevenue = completedOrders.reduce((sum, order) => sum + (parseFloat(order.total_amount) || 0), 0);
    
    let csv = headers.join(',') + '\n';
    
    // Add order data
    orders.forEach(order => {
        const row = [
            `"${order.id}"`,
            `"${order.customer_name || 'Guest'}"`,
            `"${order.customer_phone || ''}"`,
            order.items ? order.items.length : 0,
            parseFloat(order.total_amount || 0).toFixed(2),
            `"${order.status}"`,
            `"${new Date(order.created_at).toLocaleDateString()}"`,
            order.completed_at ? `"${new Date(order.completed_at).toLocaleDateString()}"` : ''
        ];
        csv += row.join(',') + '\n';
    });
    
    // Add summary section
    csv += '\n';
    csv += 'Summary\n';
    csv += `Total Orders,${orders.length}\n`;
    csv += `Completed Orders,${completedOrders.length}\n`;
    csv += `Total Revenue,${totalRevenue.toFixed(2)}\n`;
    csv += `Average Order Value,${(totalRevenue / (completedOrders.length || 1)).toFixed(2)}\n`;
    
    return csv;
}

// Enhanced Download CSV Function
function downloadCSV(csvContent, filename) {
    // Add UTF-8 BOM for Excel compatibility
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Clean up URL
    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 100);
}

// Utility Functions - ADD THESE
function showError(message) {
    showToast(message, 'error');
}

function showSuccess(message) {
    showToast(message, 'success');
}

function showInfo(message) {
    showToast(message, 'info');
}

// Add to your existing modal overlay listeners
function setupModalOverlayListeners() {
    // Handle click outside modal to close
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('modal-overlay')) {
            const modals = document.querySelectorAll('.modal-overlay');
            modals.forEach(modal => {
                if (!modal.classList.contains('hidden')) {
                    modal.classList.add('hidden');
                    document.body.style.overflow = '';
                }
            });
        }
    });
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const modals = document.querySelectorAll('.modal-overlay');
            modals.forEach(modal => {
                if (!modal.classList.contains('hidden')) {
                    modal.classList.add('hidden');
                    document.body.style.overflow = '';
                }
            });
        }
    });
}
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const modals = document.querySelectorAll('.modal-overlay');
            modals.forEach(modal => {
                if (!modal.classList.contains('hidden')) {
                    modal.classList.add('hidden');
                    document.body.style.overflow = '';
                }
            });
        }
    });

// Date range modal
function showDateRangeModal(orders = []) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h3>Export Orders</h3>
                    <button class="btn-close" onclick="closeDateRangeModal(null)">×</button>
                </div>
                <div class="modal-body">
                    <p>Select date range for export:</p>
                    <div class="form-grid">
                        <div class="input-group">
                            <label for="exportStartDate">From Date</label>
                            <input type="date" id="exportStartDate">
                        </div>
                        <div class="input-group">
                            <label for="exportEndDate">To Date</label>
                            <input type="date" id="exportEndDate">
                        </div>
                    </div>
                    <div class="quick-filters">
                        <button class="btn btn-outline btn-sm" onclick="setDateRange('today')">Today</button>
                        <button class="btn btn-outline btn-sm" onclick="setDateRange('week')">This Week</button>
                        <button class="btn btn-outline btn-sm" onclick="setDateRange('month')">This Month</button>
                        <button class="btn btn-outline btn-sm" onclick="setDateRange('all')">All Time</button>
                    </div>
                    ${orders.length > 0 ? `
                    <div class="orders-preview">
                        <small>Found ${orders.length} total orders</small>
                    </div>
                    ` : ''}
                </div>
                <div class="form-actions">
                    <button class="btn btn-secondary" onclick="closeDateRangeModal(null)">Cancel</button>
                    <button class="btn btn-primary" onclick="confirmDateRange()">Export CSV</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Set today as default end date
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('exportEndDate').value = today;
        
        // Store resolve function globally to access in other functions
        window.dateRangeResolver = resolve;
        window.dateRangeModal = modal;
    });
}

function closeDateRangeModal(result) {
    if (window.dateRangeModal) {
        window.dateRangeModal.remove();
    }
    if (window.dateRangeResolver) {
        window.dateRangeResolver(result);
        window.dateRangeResolver = null;
    }
}

function confirmDateRange() {
    const startDate = document.getElementById('exportStartDate').value;
    const endDate = document.getElementById('exportEndDate').value;
    
    // Validate dates
    if (startDate && endDate && startDate > endDate) {
        showToast('Start date cannot be after end date', 'error');
        return;
    }
    
    closeDateRangeModal({ startDate, endDate });
}

function setDateRange(range) {
    const today = new Date();
    const startDateInput = document.getElementById('exportStartDate');
    const endDateInput = document.getElementById('exportEndDate');
    
    switch(range) {
        case 'today':
            const todayStr = today.toISOString().split('T')[0];
            startDateInput.value = todayStr;
            endDateInput.value = todayStr;
            break;
            
        case 'week':
            const startOfWeek = new Date(today);
            startOfWeek.setDate(today.getDate() - today.getDay());
            startDateInput.value = startOfWeek.toISOString().split('T')[0];
            endDateInput.value = today.toISOString().split('T')[0];
            break;
            
        case 'month':
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            startDateInput.value = startOfMonth.toISOString().split('T')[0];
            endDateInput.value = today.toISOString().split('T')[0];
            break;
            
        case 'all':
            startDateInput.value = '';
            endDateInput.value = '';
            break;
    }
}


function handleSupportSubmit(e) {
    e.preventDefault();
    
    const name = document.getElementById('supportName').value;
    const email = document.getElementById('supportEmail').value;
    const message = document.getElementById('supportMessage').value;
    
    // Format message for WhatsApp
    const whatsappMessage = `Name: ${name}%0AEmail: ${email}%0AMessage: ${message}`;
    const whatsappUrl = `https://wa.me/2348111111111?text=${whatsappMessage}`;
    
    // Open WhatsApp
    window.open(whatsappUrl, '_blank');
    closeModal('supportModal');
    showToast('Opening WhatsApp...', 'success');
}

function showDeleteConfirmation(mealId, mealName) {
    // Create custom confirmation modal
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3>🗑️ Delete Meal</h3>
                <button class="btn-close" onclick="closeDeleteModal()">×</button>
            </div>
            <div class="modal-body">
                <div style="text-align: center; padding: 20px;">
                    <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
                    <h4>Delete "${mealName}"?</h4>
                    <p style="color: var(--text-muted); margin: 16px 0;">
                        This action cannot be undone. The meal will be permanently removed from your menu.
                    </p>
                </div>
            </div>
            <div class="form-actions">
                <button class="btn btn-secondary" onclick="closeDeleteModal()">
                    Cancel
                </button>
                <button class="btn btn-danger" id="confirmDeleteBtn" onclick="confirmDeleteMeal('${mealId}')">
                    🗑️ Delete Meal
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    window.currentDeleteModal = modal;
}

function closeDeleteModal() {
    if (window.currentDeleteModal) {
        window.currentDeleteModal.remove();
        window.currentDeleteModal = null;
    }
}

async function editMeal(mealId) {
    console.log("✏️ editMeal() called:", mealId);

    // Prevent multiple simultaneous edits
    if (window.currentlyEditing) {
        console.log("⚠️ Already editing a meal, please wait...");
        return;
    }

    try {
        window.currentlyEditing = true;
        
        // Show loading state in modal
        const modal = document.getElementById('mealModal');
        const title = document.getElementById("mealModalTitle");
if (!title) {
    console.error("❌ mealModalTitle missing — modal was removed from DOM.");
    forceRebuildMealModal();
    return;
}

        // Open modal first to show feedback
        openModal("mealModal");

        // Load meal details
        const { data: meal, error } = await supabase
            .from("meals")
            .select("*")
            .eq("id", mealId)
            .single();

        if (error || !meal) {
            console.error("❌ Failed to fetch meal:", error);
            showToast("Cannot load meal details", "error");
            closeModal('mealModal');
            return;
        }

        console.log("✅ Meal data loaded:", meal);

        // Set meal ID for the form
        document.getElementById("mealId").value = mealId;

        document.getElementById("mealFormTitle").textContent = "Edit Meal";
        document.getElementById("submitMealBtn").textContent = "Update Meal";
        
        // Fill form with meal data
        document.getElementById("mealName").value = meal.name || "";
        document.getElementById("mealPrice").value = meal.price || "";
        document.getElementById("mealDescription").value = meal.description || "";
        document.getElementById("mealCategory").value = meal.category || "";

        // Update modal title
        if (title) title.textContent = "Edit Meal";

        // Show current image if exists
        const preview = document.getElementById("mealImagePreview");
        if (preview) {
            if (meal.image_url) {
                preview.innerHTML = `
                    <div class="current-image">
                        <p>Current Image:</p>
                        <img src="${meal.image_url}" alt="Current meal image" style="max-width: 200px; max-height: 150px; border-radius: 8px;">
                        <p class="image-note">Select a new image to replace this one</p>
                    </div>
                `;
                preview.style.display = 'block';
            } else {
                preview.innerHTML = '';
                preview.style.display = 'none';
            }
        }

        // Clear file input
        const fileInput = document.getElementById("mealImage");
        if (fileInput) fileInput.value = "";

    } catch (error) {
        console.error("❌ Error in editMeal:", error);
        showToast("Error loading meal data", "error");
        closeModal('mealModal');
    } finally {
        window.currentlyEditing = false;
    }
}

function forceRebuildMealModal() {
    console.warn("⚠️ Rebuilding deleted meal modal...");

    // Reload page section or re-append modal from template
    location.reload(); // TEMP FIX: reload restores full DOM
}

function confirmDeleteMeal(mealId) {
    console.log("🗑️ Confirm delete for:", mealId);
    
    // Get meal name for confirmation message
    const mealCard = document.querySelector(`[data-meal-id="${mealId}"]`)?.closest('.meal-card');
    const mealName = mealCard?.querySelector('.meal-name')?.textContent || 'this meal';
    
    showConfirmModal(
        `Are you sure you want to delete "${mealName}"? This action cannot be undone.`,
        () => {
            console.log("✅ User confirmed delete for:", mealId);
            deleteMeal(mealId);
        }
    );
}

function updateImagePreview(imageUrl) {
    const preview = document.getElementById('mealImagePreview');
    if (!preview) {
        // Create preview container if it doesn't exist
        const imageGroup = document.querySelector('.input-group:has(#mealImage)');
        if (imageGroup) {
            const newPreview = document.createElement('div');
            newPreview.id = 'mealImagePreview';
            newPreview.className = 'image-preview';
            imageGroup.appendChild(newPreview);
        }
    }
    
    const imagePreview = document.getElementById('mealImagePreview');
    if (!imagePreview) return;
    
    if (imageUrl) {
        imagePreview.innerHTML = `
            <div class="current-image">
                <p>Current Image:</p>
                <img src="${imageUrl}" alt="Current meal image" style="max-width: 200px; max-height: 150px; border-radius: 8px;">
                <p class="image-note">Select a new image to replace this one</p>
            </div>
        `;
        imagePreview.style.display = 'block';
    } else {
        imagePreview.innerHTML = '';
        imagePreview.style.display = 'none';
    }
}

function setupMealSearch() {
    const searchInput = document.getElementById('mealSearch');
    const categoryFilter = document.getElementById('categoryFilter');
    
    if (searchInput) {
        searchInput.addEventListener('input', debounce(filterMeals, 300));
    }
    
    if (categoryFilter) {
        categoryFilter.addEventListener('change', filterMeals);
    }
}

function filterMeals() {
    const searchTerm = document.getElementById('mealSearch')?.value.toLowerCase() || '';
    const category = document.getElementById('categoryFilter')?.value || '';
    
    const mealCards = document.querySelectorAll('.meal-card');
    let visibleCount = 0;
    
    mealCards.forEach(card => {
        const mealName = card.querySelector('.meal-name')?.textContent.toLowerCase() || '';
        const mealCategory = card.querySelector('.meal-category')?.textContent || '';
        const mealDescription = card.querySelector('.meal-description')?.textContent.toLowerCase() || '';
        
        const matchesSearch = mealName.includes(searchTerm) || mealDescription.includes(searchTerm);
        const matchesCategory = !category || mealCategory === category;
        
        if (matchesSearch && matchesCategory) {
            card.style.display = 'flex';
            visibleCount++;
        } else {
            card.style.display = 'none';
        }
    });
}

function clearFilters() {
    document.getElementById('mealSearch').value = '';
    document.getElementById('categoryFilter').value = '';
    filterMeals();
}

function updateOrderStatus(orderId, status) {
    showToast(`Order ${status}!`, 'success');
}

function deleteOrder(orderId) {
    if (!confirm('Are you sure you want to delete this order?')) return;
    showToast('Order deleted!', 'success');
}

function exportOrders() {
    showToast('Export feature coming soon!', 'info');
}

function editCompanyInfo() {
    showToast('Edit company feature coming soon!', 'info');
}

function changePassword() {
    showToast('Change password feature coming soon!', 'info');
}

function setupRealTimeValidation() {
    // Password strength check
    const passwordField = document.getElementById('regPassword');
    if (passwordField) {
        passwordField.addEventListener('input', function() {
            if (this.value.length > 0 && this.value.length < 6) {
                showFieldError('regPassword', 'Password must be at least 6 characters');
            } else {
                clearFieldError('regPassword');
            }
        });
    }
    
    // Confirm password match
    const confirmPasswordField = document.getElementById('regConfirmPassword');
    if (confirmPasswordField) {
        confirmPasswordField.addEventListener('input', function() {
            const password = document.getElementById('regPassword').value;
            if (this.value !== password) {
                showFieldError('regConfirmPassword', 'Passwords do not match');
            } else {
                clearFieldError('regConfirmPassword');
            }
        });
    }
    
    // Email validation
    const emailField = document.getElementById('regEmail');
    if (emailField) {
        emailField.addEventListener('blur', function() {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (this.value && !emailRegex.test(this.value)) {
                showFieldError('regEmail', 'Please enter a valid email address');
            } else {
                clearFieldError('regEmail');
            }
        });
    }
}

async function loadDashboardData() {
    try {
        if (!currentCompany) {
            console.log('❌ No company data for dashboard');
            return;
        }

        console.log('📊 Loading dashboard data for company:', currentCompany.id);

        // Meals count
        const { count: mealsCount, error: mealsError } = await supabase
            .from('meals')
            .select('*', { count: 'exact', head: true })
            .eq('company_id', currentCompany.id);
        
        if (!mealsError) {
            document.getElementById('totalMeals').textContent = mealsCount || 0;
        }

        // Orders + Revenue
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select('total_amount, status, created_at, customer_name')
            .eq('company_id', currentCompany.id)
            .order('created_at', { ascending: false });
        
        if (!ordersError && orders) {
            document.getElementById('totalOrders').textContent = orders.length;
            const revenue = orders
                .filter(o => o.status === 'completed')
                .reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
            document.getElementById('totalRevenue').textContent = `₦${revenue.toLocaleString()}`;
            loadRecentActivities(orders);
        }

        // Active Menus
        document.getElementById('totalMenus').textContent = '1';

    } catch (error) {
        console.error('❌ Dashboard load error:', error);
    }
}

// Load recent activities
function loadRecentActivities(orders) {
    const recentActivity = document.getElementById('recentActivity');
    if (!recentActivity) return;

    if (!orders || orders.length === 0) {
        recentActivity.innerHTML = '<div class="empty-state">No recent activity</div>';
        return;
    }

    const activities = orders.map(order => `
        <div class="activity-item">
            <div class="activity-icon">🛒</div>
            <div class="activity-content">
                <div class="activity-title">New order from ${order.customer_name || 'Customer'}</div>
                <div class="activity-details">
                    <span class="status-badge status-${order.status}">${order.status}</span>
                    <span class="activity-time">${new Date(order.created_at).toLocaleString()}</span>
                </div>
            </div>
            <div class="activity-amount">₦${parseFloat(order.total_amount || 0).toLocaleString()}</div>
        </div>
    `).join('');

    recentActivity.innerHTML = activities;
}

// Add this to test orders loading
async function testOrdersLoading() {
    if (!currentCompany) {
        console.log('❌ No company data available');
        return;
    }
    
    console.log('🧪 Testing orders loading for company:', currentCompany.id);
    
    try {
        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .eq('company_id', currentCompany.id)
            .order('created_at', { ascending: false })
            .limit(5);

        if (error) {
            console.error('❌ Test query failed:', error);
            return;
        }
        
        console.log('✅ Test successful. Orders found:', data?.length || 0);
        console.log('Sample orders:', data);
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

async function loadMealData(mealId) {
    try {
        console.log('📥 Loading meal data for:', mealId);
        
        const { data: meal, error } = await supabase
            .from('meals')
            .select('*')
            .eq('id', mealId)
            .single();

        if (error) throw error;

        // Populate form
        document.getElementById('mealName').value = meal.name || '';
        document.getElementById('mealPrice').value = meal.price || '';
        document.getElementById('mealDescription').value = meal.description || '';
        document.getElementById('mealCategory').value = meal.category || '';
        
        // Show current image if exists
        updateImagePreview(meal.image_url);
        
        console.log('✅ Meal data loaded:', meal.name);
        
    } catch (error) {
        console.error('❌ Error loading meal:', error);
        showToast('Error loading meal data', 'error');
    }
}
// Support Modal Functions
function openSupportModal() {
    console.log('Opening support modal');
    const modal = document.getElementById('supportModal');
    const form = document.getElementById('supportForm');
    
    if (!modal || !form) {
        console.error('Support modal elements not found');
        return;
    }
    
    // Pre-fill with user data if available
    if (currentUser) {
        const nameInput = document.getElementById('supportName');
        const emailInput = document.getElementById('supportEmail');
        
        if (nameInput) nameInput.value = currentUser.email?.split('@')[0] || '';
        if (emailInput) emailInput.value = currentUser.email || '';
    }
    
    if (form) form.reset();
    if (modal) {
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }
}

function handleSupportSubmit(e) {
    e.preventDefault();
    
    const name = document.getElementById('supportName')?.value || '';
    const email = document.getElementById('supportEmail')?.value || '';
    const message = document.getElementById('supportMessage')?.value || '';
    
    if (!name || !email || !message) {
        showToast('Please fill in all fields', 'error');
        return;
    }
    
    // Format message for WhatsApp
    const whatsappMessage = `Support Request:%0A%0AName: ${name}%0AEmail: ${email}%0AMessage: ${message}`;
    const whatsappUrl = `https://wa.me/2348111111111?text=${whatsappMessage}`;
    
    // Open WhatsApp
    window.open(whatsappUrl, '_blank');
    closeModal('supportModal');
    showToast('Opening WhatsApp...', 'success');
}

function closeSupportModal() {
    const modal = document.getElementById('supportModal');
    if (modal) {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
    }
}

// Make functions globally available
window.showSection = showSection;
window.toggleSidebar = toggleSidebar;
window.openMealModal = openMealModal;
window.closeModal = closeModal;
window.generateQRCode = generateQRCode;
window.generateMenuQRCode = generateMenuQRCode;
window.debugQRCodeState = debugQRCodeState;
window.debugQRButtons = debugQRButtons;
window.downloadQRCode = downloadQRCode;
window.testQRFunctionality = testQRFunctionality;
window.copyMenuLink = copyMenuLink;
window.openQRModal = openQRModal;
window.closeQRModal = closeQRModal;
window.editCompanyInfo = editCompanyInfo;
window.openSubscriptionModal = openSubscriptionModal;
window.changePassword = changePassword;
window.exportOrders = exportOrders;
window.startFreeTrial = startFreeTrial;
window.openSupportModal = openSupportModal;
window.handleSupportSubmit = handleSupportSubmit;
window.debugSession = debugSession; // Keep for troubleshooting
window.forceLogout = forceLogout; // Keep for emergency

window.closeDateRangeModal = closeDateRangeModal;
window.confirmDateRange = confirmDateRange;
window.setDateRange = setDateRange;

// Make these functions globally available
window.testBackendOrderUpdate = testBackendOrderUpdate;
window.showOrderIds = showOrderIds;
window.testWithRealOrder = testWithRealOrder;
window.handleOrderAction = handleOrderAction;

// Stub functions for UI elements
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
    }
}

function debugQRDownloadIssue() {
    console.log('=== QR DOWNLOAD DEBUG ===');
    
    // 1. Check if buttons exist
    const downloadBtn = document.getElementById('downloadQRBtn');
    const copyBtn = document.getElementById('copyLinkBtn');
    console.log('1. Download button exists:', !!downloadBtn);
    console.log('2. Copy button exists:', !!copyBtn);
    
    // 2. Check button states
    if (downloadBtn) {
        console.log('3. Download button disabled:', downloadBtn.disabled);
        console.log('4. Download button onclick:', downloadBtn.onclick);
    }
    
    if (copyBtn) {
        console.log('5. Copy button disabled:', copyBtn.disabled);
        console.log('6. Copy button onclick:', copyBtn.onclick);
    }
    
    // 3. Check QR code state
    console.log('7. QR Code State:', qrCodeState);
    
    // 4. Check if QR image exists
    const qrImage = document.getElementById('qrCodeImage');
    console.log('8. QR Image exists:', !!qrImage);
    if (qrImage) {
        console.log('9. QR Image src:', qrImage.src);
    }
    
    // 5. Check container
    const container = document.getElementById('qrCodeContainer');
    console.log('10. QR Container exists:', !!container);
    console.log('11. QR Container content:', container?.innerHTML);
    
    console.log('=== END DEBUG ===');
}
// Emergency close all modals function for mobile
function emergencyCloseAllModals() {
    console.log('🚨 EMERGENCY CLOSE ALL MODALS');
    
    const modals = document.querySelectorAll('.modal-overlay');
    let closedCount = 0;
    
    modals.forEach(modal => {
        if (!modal.classList.contains('hidden')) {
            modal.classList.add('hidden');
            modal.style.display = 'none';
            modal.style.visibility = 'hidden';
            closedCount++;
        }
    });
    
    // Reset body completely
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.classList.remove('modal-open');
    
    // ✅ SAFELY reset all pending states
    if (typeof pendingSubscriptionCallback !== 'undefined') {
        pendingSubscriptionCallback = null;
    }
    if (typeof pendingAction !== 'undefined') {
        pendingAction = null;
    }
    
    console.log(`✅ Closed ${closedCount} modals, reset all states`);
    showToast('All modals closed', 'info');
}

// Make it available globally
window.emergencyCloseAllModals = emergencyCloseAllModals;

// Run this in browser console and tell me the output
window.debugQRDownloadIssue = debugQRDownloadIssue;

// Debug function for mobile modal issues
function debugMobileModal() {
    console.log('📱 MOBILE MODAL DEBUG:');
    console.log('1. Window width:', window.innerWidth);
    console.log('2. Is mobile:', window.innerWidth <= 768);
    
    const modal = document.getElementById('subscriptionModal');
    console.log('3. Modal exists:', !!modal);
    console.log('4. Modal hidden:', modal?.classList.contains('hidden'));
    console.log('5. Modal display:', modal?.style.display);
    console.log('6. Modal z-index:', modal?.style.zIndex);
    
    const overlay = document.querySelector('.modal-overlay#subscriptionModal');
    console.log('7. Overlay exists:', !!overlay);
    console.log('8. Overlay hidden:', overlay?.classList.contains('hidden'));
    
    console.log('9. Body overflow:', document.body.style.overflow);
    console.log('10. Body position:', document.body.style.position);
}

// Make it available globally
window.debugMobileModal = debugMobileModal;

function copyMenuLink() {
    console.log('Copying menu link');
    // Add your copy logic here
}

function editCompanyInfo() {
    showToast('Edit company feature coming soon!', 'info');
}

function changePassword() {
    showToast('Change password feature coming soon!', 'info');
}

function exportOrders() {
    showToast('Export feature coming soon!', 'info');
}

function assignSubscription(plan) {
    showToast(`Subscribing to ${plan} plan`, 'info');
}

// Support Modal Function
function openSupportModal() {
    const modal = document.getElementById('supportModal');
    if (modal) {
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        
        // Pre-fill with user data if available
        if (currentUser) {
            const nameInput = document.getElementById('supportName');
            const emailInput = document.getElementById('supportEmail');
            
            if (nameInput) nameInput.value = currentUser.email?.split('@')[0] || '';
            if (emailInput) emailInput.value = currentUser.email || '';
        }
    }
} // ← MAKE SURE THIS CLOSING BRACE EXISTS!

function closeSupportModal() {
    const modal = document.getElementById('supportModal');
    modal.classList.add('hidden');
    document.body.style.overflow = '';
} // ← This is the last line of your file

function resetMealEditingState() {
    editingMealId = null;
    isEditingMeal = false;
}


window.manualLoginTest = async function(testEmail = 'king@gmail.com', testPassword = 'test123') {
    console.log('🧪 MANUAL LOGIN TEST');
    
    try {
        showLoading('Testing login...');
        
        const result = await emergencyLogin(testEmail, testPassword);
        console.log('✅ MANUAL TEST SUCCESS:', result);
        showToast('Manual test successful!', 'success');
        
    } catch (error) {
        console.error('❌ MANUAL TEST FAILED:', error);
        showToast('Manual test failed: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
};

console.log('🎉 Restaurant Dashboard Script Loaded Successfully');
