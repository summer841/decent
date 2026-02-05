
import { GoogleGenAI } from "@google/genai";

export const askGemini = async (prompt: string) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction: `당신은 회사의 인사 관리 AI 도우미입니다. 
        한국의 근로기준법과 회사의 연차 정책을 바탕으로 답변해주세요.
        연차 발생 정책:
        1. 1년 미만: 1개월 만근 시 1개씩 (최대 11개).
        2. 1년 이상: 기본 15개 발생.
        3. 가산 연차: 근속 2년이 지난 시점(3년 차)부터 매 2년마다 1일씩 가산 (예: 3~4년차 16일, 5~6년차 17일...). 최대 25일 한도.
        연차 종류 및 차감 방식: 
        - 일반연차: 평일 1일 차감
        - 오전 반차 / 오후 반차: 평일 0.5일 차감
        - 보너스연차: 평일 1일 차감 (보너스 한도에서 우선 차감)
        - 생일반차 / 공결: 0일 차감
        답변 시 사용자의 근속 연수와 신청하려는 연차 종류에 따른 차감 일수를 친절하고 명확하게 한국어로 설명하세요.`
      }
    });
    return response.text;
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "죄송합니다. AI 답변을 생성하는 중 오류가 발생했습니다.";
  }
};
