import type { ExpoConfig } from "expo/config";

// Android 온리. ios 키를 아예 두지 않는다.
// 앱 이름은 "ReBody" — 워드마크의 콜론(Re:Body)은 Play Console·패키지명·도메인에서
// 사용할 수 없으므로 로고 그래픽에만 쓴다.

const config: ExpoConfig = {
  name: "ReBody",
  slug: "rebody",
  scheme: "rebody",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",

  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#0F1115",
  },

  android: {
    package: "com.rebody.app",
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#0F1115",
    },
    permissions: [
      "CAMERA",
      // Android 13+ 알림 권한. 소프트 애스크 후에만 시스템 다이얼로그를 띄운다.
      "POST_NOTIFICATIONS",
      // 정확한 알림 시각이 필요하지만 SCHEDULE_EXACT_ALARM은 요청하지 않는다.
      // 서버 푸시(FCM)로 처리하므로 불필요하고, 심사에서 정당화 요구를 받는다.
    ],
    blockedPermissions: [
      // expo-camera가 기본으로 넣는 것들. 사진 촬영만 하므로 전부 뺀다.
      "android.permission.RECORD_AUDIO",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ],
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
    edgeToEdgeEnabled: true,
  },

  plugins: [
    "expo-router",
    [
      "expo-camera",
      {
        cameraPermission: "식사 사진을 찍어 영양성분을 분석하기 위해 카메라를 사용합니다.",
        recordAudioAndroid: false,
      },
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/notification-icon.png",
        color: "#4ADE80",
      },
    ],
  ],

  extra: {
    eas: {
      // eas init 실행 후 채워진다.
      projectId: process.env.EAS_PROJECT_ID ?? "",
    },
  },

  updates: {
    // OTA 우선 전략 (docs/01_COST.md) — JS 변경은 eas update로 배포해 빌드 쿼터를 아낀다.
    url: process.env.EAS_UPDATE_URL,
    fallbackToCacheTimeout: 0,
  },
  runtimeVersion: { policy: "appVersion" },
};

export default config;
