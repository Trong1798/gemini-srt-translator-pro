
import { SubtitleEntry } from "../types";

export function parseSRT(content: string): SubtitleEntry[] {
  // Chuẩn hóa xuống dòng và loại bỏ BOM nếu có
  const normalizedContent = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  
  // Tách các khối bằng 2 hoặc nhiều dấu xuống dòng
  const blocks = normalizedContent.split(/\n\s*\n/);
  const subtitles: SubtitleEntry[] = [];

  blocks.forEach((block) => {
    const lines = block.trim().split('\n').filter(l => l.trim() !== '');
    if (lines.length >= 3) {
      // Dòng 1 thường là ID, nhưng đôi khi file lỗi có thể thiếu. Kiểm tra logic timeline ở dòng 2.
      let idStr = lines[0].trim();
      let timelineIndex = 1;
      
      // Nếu dòng đầu không phải số, có thể dòng đầu là timeline luôn (thiếu ID)
      if (isNaN(parseInt(idStr))) {
        idStr = (subtitles.length + 1).toString();
        timelineIndex = 0;
      }

      const timeline = lines[timelineIndex];
      const text = lines.slice(timelineIndex + 1).join(' ').trim();

      // Regex linh hoạt hơn cho timeline
      const timeMatch = timeline.match(/(\d{1,2}:\d{2}:\d{2}[.,]\d{2,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{2,3})/);
      
      if (timeMatch && text) {
        subtitles.push({
          id: parseInt(idStr) || (subtitles.length + 1),
          startTime: timeMatch[1].replace('.', ','),
          endTime: timeMatch[2].replace('.', ','),
          text
        });
      }
    }
  });

  return subtitles;
}

export function exportToSRT(subtitles: SubtitleEntry[]): string {
  return subtitles
    .map((s, idx) => {
      return `${idx + 1}\n${s.startTime} --> ${s.endTime}\n${s.text}\n`;
    })
    .join('\n');
}
