
import { GoogleGenAI, Type } from "@google/genai";
import { SubtitleEntry } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function translateSubtitleBatch(
  subtitles: SubtitleEntry[],
  customPrompt: string
): Promise<{ id: number; translatedText: string }[]> {
  const model = "gemini-3-flash-preview";
  
  const systemInstruction = `
    You are a professional subtitle translator.
    Translate the text to Vietnamese.
    - Style: ${customPrompt || "Professional, natural, and accurate."}
    - Rules: NO extra text, ONLY the JSON array.
    - Input: JSON array with 'id' and 'text'.
    - Output: JSON array with 'id' and 'translatedText'.
  `;

  const prompt = JSON.stringify(subtitles.map(s => ({ id: s.id, text: s.text })));

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.INTEGER },
              translatedText: { type: Type.STRING }
            },
            required: ["id", "translatedText"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("AI returned empty response");
    
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error("Malformed JSON from AI:", text);
      throw new Error("AI trả về dữ liệu không đúng cấu trúc JSON");
    }
  } catch (error: any) {
    console.error("Gemini Translation Error:", error);
    if (error.message?.includes("429")) {
      throw new Error("Tốc độ dịch quá nhanh (Rate Limit). Vui lòng đợi 1 lát.");
    }
    if (error.message?.includes("401") || error.message?.includes("403")) {
      throw new Error("API Key không hợp lệ hoặc không có quyền truy cập.");
    }
    throw new Error(error.message || "Lỗi kết nối API Gemini");
  }
}
