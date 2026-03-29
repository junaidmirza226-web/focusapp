#!/bin/bash

# FocusFine App Signing Key Generation Script
# This creates the signing keystore needed for Play Store publication

# Configuration
KEYSTORE_NAME="focusfine-release.keystore"
KEY_ALIAS="focusfine"
VALIDITY_DAYS=10950  # 30 years
KEYSTORE_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$KEYSTORE_NAME"

echo "=========================================="
echo "FocusFine - Play Store Signing Key"
echo "=========================================="
echo ""
echo "This will create a signing key for Play Store publication."
echo "⚠️  KEEP THIS FILE SAFE - DO NOT COMMIT TO VERSION CONTROL"
echo ""

# Check if keytool is available
if ! command -v keytool &> /dev/null; then
    echo "❌ Error: keytool not found. Please install Java JDK."
    exit 1
fi

# Check if keystore already exists
if [ -f "$KEYSTORE_PATH" ]; then
    echo "⚠️  Keystore already exists at: $KEYSTORE_PATH"
    read -p "Overwrite? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Cancelled."
        exit 1
    fi
    rm "$KEYSTORE_PATH"
fi

# Generate keystore
keytool -genkey -v -keystore "$KEYSTORE_PATH" \
    -keyalg RSA \
    -keysize 2048 \
    -validity $VALIDITY_DAYS \
    -alias "$KEY_ALIAS" \
    -storetype JKS

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Keystore created successfully!"
    echo "📁 Location: $KEYSTORE_PATH"
    echo ""
    echo "Next steps:"
    echo "1. Add to .gitignore: echo 'android/keystore/*.keystore' >> .gitignore"
    echo "2. Update gradle.properties with keystore details"
    echo "3. Configure build.gradle with signing config"
else
    echo "❌ Error creating keystore"
    exit 1
fi
