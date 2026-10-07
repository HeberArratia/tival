import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#202023",
          borderRadius: 44,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: 118,
            height: 118,
          }}
        >
          <div
            style={{
              width: 78,
              height: 14,
              borderRadius: 999,
              background:
                "linear-gradient(90deg, #ee797e 0%, #edbdbc 55%, #8bb9b9 100%)",
              marginBottom: -2,
            }}
          />
          <div
            style={{
              width: 14,
              height: 72,
              borderRadius: 999,
              background: "linear-gradient(180deg, #ee797e 0%, #8bb9b9 100%)",
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
