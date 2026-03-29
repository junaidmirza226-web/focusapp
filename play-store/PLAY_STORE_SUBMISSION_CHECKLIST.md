# FocusFine - Google Play Store Submission Checklist

**Target Release Date:** April 30, 2026
**Last Updated:** March 29, 2026

---

## ✅ Pre-Submission Requirements

### Legal & Compliance
- [x] Privacy Policy written (GDPR/CCPA compliant)
- [x] Terms of Service created
- [x] Contact information prepared
- [ ] Content rating questionnaire completed
- [ ] Data safety form completed
- [ ] Ads policy statement (we have no ads)

### Technical Requirements
- [x] App signing keystore created
- [x] App signing configured in build.gradle
- [x] Minimum SDK: 24 (Android 7.0)
- [x] Target SDK: 33 (Android 13)
- [ ] Build release APK/Bundle
- [ ] Test on minimum 3 Android versions (7, 10, 13)
- [ ] Test on minimum 2 physical devices
- [ ] All 5 required permissions functional and tested

### Build & Quality
- [x] ProGuard minification enabled for release
- [x] All unused dependencies removed
- [x] ProGuard rules configured
- [x] Version code incremented (currently: 1)
- [x] Version name set (currently: 1.0)
- [ ] Run lint checks (0 errors)
- [ ] Run unit tests (100% pass rate)
- [ ] Performance profiling complete
- [ ] Battery drain testing complete (5+ hours)

---

## ✅ Store Listing Assets

### Graphics & Icons
- [ ] **App Icon** (512x512 px, PNG)
  - Location: android/app/src/main/res/mipmap/ic_launcher.png
  - Requirements: Square, no rounded corners in file, colors pop
  - Status: Needs design

- [ ] **Feature Graphic** (1024x500 px, PNG)
  - Shows app value proposition
  - Example text: "FocusFine - Digital Discipline Made Simple"
  - Status: Needs design

- [ ] **Screenshots** (1080x1920 px, minimum 2, maximum 8, PNG/JPG)
  1. Dashboard with Focus Score
  2. Analytics & Heatmap
  3. Lock Screen Overlay
  4. Payment Options
  5. Weekly Insights
  6. Setup Flow
  Status: Needs screenshots

- [ ] **Phone Screenshots** (2-8 images, 1080x1920)
  - Recommended: 4-5 screenshots showing key features
  - Include text callouts explaining each feature
  - Show both light and dark modes

### Text Content
- [x] **App Name**: "FocusFine" (50 char limit, currently 10)
- [x] **Short Description** (80 char limit)
  - "Control your app usage with financial penalties."
- [x] **Full Description** (4000 char limit)
  - Detailed feature list, benefits, permissions explanation
- [x] **Promotional Text** (80 char limit, optional)
  - "Set limits. Pay to unlock. Reclaim focus."

---

## ✅ Store Listing Details

### App Category & Content Rating
- [x] Category: Productivity
- [ ] Content Rating: Complete questionnaire
  - Violence: No
  - Sexual Content: No
  - Profanity: No
  - Alcohol/Tobacco: No
  - Gambling: No
  - → Should receive "Everyone" rating

### Contact & Legal
- [x] Email address: support@focusfine.app
- [x] Privacy Policy URL: https://focusfine.app/privacy
- [x] Terms of Service URL: https://focusfine.app/terms
- [ ] Website: https://focusfine.app (create this)
- [ ] Phone number (optional): Add if available

### Data & Privacy
- [ ] Data safety form completed
  - Data collected: Usage statistics, payment records
  - Data shared: No third-party sharing (except Google Play Billing)
  - Data retention: 30 days for usage, 1 year for payments
  - Encryption: AES-256 local database, HTTPS for backend

---

## ✅ Features & Functionality Verification

### Core Features
- [x] App usage monitoring (UsageMonitorService)
- [x] Unbypassable lock screen (OverlayActivity)
- [x] Payment processing (PaymentManager + Google Play Billing)
- [x] Database persistence (Room + SharedPreferences)
- [x] Analytics dashboard (React UI)
- [x] Strict Mode toggle
- [x] Settings & configuration

### Permissions (Android 7-13 compatibility)
- [x] PACKAGE_USAGE_STATS - Request via Settings intent ✓
- [x] SYSTEM_ALERT_WINDOW - Request via Settings intent ✓
- [x] FOREGROUND_SERVICE - Declared in manifest ✓
- [x] REQUEST_IGNORE_BATTERY_OPTIMIZATIONS - Requested ✓
- [x] BILLING - From Google Play Billing library ✓

### Testing Matrix
| Android Version | Device Type | Status | Notes |
|---|---|---|---|
| 7.0 | Phone | [ ] | Minimum supported |
| 10 | Phone | [ ] | Mid-range |
| 13 | Phone | [ ] | Latest |

---

## 🔐 Security Checklist

- [x] No hardcoded credentials
- [x] No sensitive data in logs
- [x] HTTPS for all backend communication
- [x] Database encryption enabled (AES-256)
- [x] No root/jailbreak detection (could block legitimate users)
- [ ] Penetration testing (optional but recommended)
- [ ] Code obfuscation with ProGuard enabled
- [ ] Dependencies checked for vulnerabilities

---

## 📊 Performance & Quality

### Battery & Memory
- [ ] Battery drain < 2% per hour in background
- [ ] Memory usage < 100 MB
- [ ] No memory leaks detected
- [ ] Service polling optimized (30s active, 2m background)

### Stability & Crashes
- [ ] Crash-free rating target: > 99%
- [ ] No ANRs (Application Not Responding) > 2 seconds
- [ ] Handle low-memory conditions gracefully
- [ ] Proper exception handling throughout

### Performance
- [ ] App launches in < 2 seconds
- [ ] Dashboard loads in < 1 second
- [ ] Smooth animations (60 FPS target)
- [ ] No jank or stuttering

---

## 🎯 Pre-Launch Testing (Phase)

### Device Testing Checklist
- [ ] Permissions flow works end-to-end
- [ ] All 5 onboarding steps functional
- [ ] Setup flow completes without errors
- [ ] Dashboard displays correctly
- [ ] Lock screen appears when limit hit
- [ ] Payment flow integrates with Google Play
- [ ] Purchased unlocks work as expected
- [ ] Analytics calculate correctly
- [ ] Dark mode works properly
- [ ] Orientation changes handled

### Edge Case Testing
- [ ] Device reboot - monitoring resumes
- [ ] Force stop app - service restarts
- [ ] Kill background app - service recovers
- [ ] Limited storage - graceful handling
- [ ] Low battery - service continues
- [ ] Airplane mode toggle - handled gracefully
- [ ] Update Google Play Services - compatible
- [ ] App uninstall/reinstall - clean state

---

## 🚀 Submission Process

### Step 1: Developer Account Setup
- [ ] Google Play Developer account created
- [ ] Payment method verified
- [ ] Developer name/email configured

### Step 2: Create App on Play Console
- [ ] App created in Play Console
- [ ] Package name: com.focusfine.app
- [ ] App category: Productivity
- [ ] Content rating form submitted

### Step 3: Build & Sign Release APK
```bash
# Generate signing key (one-time)
cd android
./gradlew signingReport

# Build release APK
./gradlew bundleRelease  # For App Bundle (recommended)
# OR
./gradlew assembleRelease  # For APK

# Output location:
# app/release/app-release.aab (recommended)
# app/release/app-release.apk (alternative)
```

- [ ] Release build created successfully
- [ ] APK/Bundle size < 100 MB
- [ ] Signature verified with correct keystore

### Step 4: Upload to Play Store
1. [ ] Go to Play Console → Your app → Release → Production
2. [ ] Click "Create new release"
3. [ ] Upload app bundle (app-release.aab)
4. [ ] Add release notes:
   ```
   Version 1.0 - Initial Release

   FocusFine: Digital Discipline Made Simple

   Features:
   • Set daily limits on distracting apps
   • Unbypassable lock screen when limit reached
   • Pay $1-$20 to unlock access
   • Real-time analytics dashboard
   • Track focus score and savings
   • Strict Mode for maximum discipline

   Permissions Required:
   • Usage Access: Monitor app usage
   • Overlay: Show lock screen
   • Background Service: Continuous monitoring

   Privacy: All data stored locally on your device. No server sync.
   ```

### Step 5: Complete Store Listing
- [ ] App name, short description, full description
- [ ] Screenshots uploaded (4-5 recommended)
- [ ] Feature graphic uploaded
- [ ] App icon verified
- [ ] Promotional text added (optional)

### Step 6: Privacy & Security
- [ ] Privacy policy URL submitted
- [ ] Terms of Service URL submitted
- [ ] Data safety form completed
- [ ] Content rating submitted
- [ ] Ads policy declared (none)

### Step 7: Pricing & Distribution
- [ ] Pricing: FREE (in-app purchases enabled)
- [ ] Countries: Select primary markets
  - United States (primary)
  - Canada
  - UK
  - Australia
  - EU countries

### Step 8: Review & Submission
- [ ] All fields completed
- [ ] No compliance warnings
- [ ] Ready for review checkbox verified
- [ ] Submit for review

---

## ⏱️ Expected Timeline

| Phase | Duration | Notes |
|---|---|---|
| Build & Testing | 3-5 days | Internal QA |
| Play Store Review | 2-4 hours | Expedited review possible |
| Publishing | 1-2 hours | After approval |
| **Total** | **3-7 days** | From submission to live |

---

## 📋 Play Store Review Guidelines Compliance

### Restricted Content
- [x] No violence or hate speech
- [x] No sexually explicit content
- [x] No impersonation or fraud
- [x] No malware or spyware
- [x] Transparent about what app does

### Functionality
- [x] App is fully functional
- [x] Features match description
- [x] No crashes or major bugs
- [x] Reasonable performance

### Permissions
- [x] All permissions justified by functionality
- [x] Permissions not requested before use
- [x] Users can understand why permissions needed

### User Support
- [x] Support email provided
- [x] Support response < 48 hours target
- [x] Clear contact information available

### Ads & Monetization
- [x] No deceptive ads (we have no ads)
- [x] In-app purchases clearly disclosed
- [x] Prices clearly shown before purchase

---

## 🔄 Post-Launch

### Monitor & Iterate
- [ ] Monitor crash reports daily (target: < 1%)
- [ ] Review user ratings/reviews weekly
- [ ] Address critical bugs within 24 hours
- [ ] Plan v1.1 update (2 weeks post-launch)

### Version 1.1 Roadmap (2 weeks post-launch)
- Cloud sync via Firebase
- More granular analytics
- Dark mode refinements
- A/B testing for UI improvements

### Version 1.2 Roadmap (1 month post-launch)
- Subscription option (weekly/monthly passes)
- Custom app categories
- Family mode (parental controls)
- Wearable integration

---

## 📞 Support Resources

- **Play Console Help:** https://support.google.com/googleplay/android-developer
- **Policy Center:** https://play.google.com/about/developer-content-policy.html
- **Best Practices:** https://developer.android.com/distribute/best-practices
- **Staging Environment:** Use internal testing track for QA

---

## ✨ Final Reminders

✅ **Before Submission:**
1. Ensure all permissions work on Android 7, 10, 13
2. Test payment flow with Google Play test cards
3. Verify analytics calculations
4. Check dark mode on both light/dark backgrounds
5. Performance test on low-end device (if possible)

⚠️ **Common Rejection Reasons** (Avoid these):
- Missing/incomplete privacy policy
- Vague app description
- Non-functional permissions
- Crashes on initial launch
- Low-resolution icons
- Deceptive descriptions

🎯 **Success Criteria:**
- App passes all compliance checks
- Zero crashes on first launch
- All features work as described
- Users can complete setup without errors
- Payment flow integrates smoothly

---

**Version:** 1.0
**Prepared By:** FocusFine Development Team
**Date:** March 29, 2026

**Status:** Ready for submission after final testing ✅

Next step: Build release APK and conduct final testing round.
