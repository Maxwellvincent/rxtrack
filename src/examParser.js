export async function parseExamPDF(file) {
  if (!window.pdfjsLib) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        res();
      };
      s.onerror = () => rej(new Error("PDF.js failed to load"));
      document.head.appendChild(s);
    });
  } else {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;
  const OPS = window.pdfjsLib.OPS || {};

  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((x) => x.str).join(" ").trim();
    let imgCount = 0;
    try {
      const ops = await page.getOperatorList();
      if (ops && ops.fnArray) {
        imgCount = ops.fnArray.filter(
          (fn) =>
            fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject
        ).length;
      }
    } catch (e) {
      // ignore
    }
    pages.push({ pageNum: i, text, imgCount, page });
  }

  const questionGroups = {};
  for (const p of pages) {
    const match = p.text.match(/QUESTION\s+(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!questionGroups[num]) questionGroups[num] = [];
      questionGroups[num].push(p);
    }
  }

  const questions = [];
  const sortedEntries = Object.entries(questionGroups).sort(
    (a, b) => parseInt(a[0], 10) - parseInt(b[0], 10)
  );

  for (const [numStr, group] of sortedEntries) {
    const num = parseInt(numStr, 10);
    const firstPage = group[0];
    const isImageQuestion =
      firstPage.imgCount > 5 && firstPage.text.length < 200;

    if (isImageQuestion) {
      const renderPageToBase64 = async (pdfPage) => {
        const viewport = pdfPage.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        return canvas.toDataURL("image/png").split(",")[1];
      };

      const questionImg = await renderPageToBase64(firstPage.page);
      const answerImg =
        group.length > 1 ? await renderPageToBase64(group[1].page) : null;

      const topicLines = firstPage.text
        .replace(/QUESTION\s+\d+\s*/, "")
        .split(/\s{2,}/)
        .filter(Boolean);
      const topic = topicLines.slice(0, 2).join(" — ") || "Histology";

      questions.push({
        id: "q" + num,
        num,
        type: "image",
        imageQuestion: true,
        subject: "Histology",
        topic,
        stem:
          "Examine the histological slide shown. Identify the labeled structures or answer the question about this tissue section.",
        questionPageImage: questionImg,
        answerPageImage: answerImg,
        choices: {
          A: "(Answer choices visible in the slide image above)",
          B: "(Select based on the labeled image)",
          C: "(See slide labels)",
          D: "(See slide labels)",
        },
        correct: null,
        explanation:
          "Review the annotated answer slide which labels the correct structures in this " +
          topic +
          " specimen.",
        difficulty: "medium",
      });
    } else {
      const stemPageText = firstPage.text.replace(/QUESTION\s+\d+\s*/, "");
      const explPageText =
        group.length > 1
          ? group[group.length - 1].text.replace(/QUESTION\s+\d+\s*/, "")
          : "";

      const lines = stemPageText.split(/\n|\s{3,}/);
      const stemLines = [];
      const choices = {};
      let inChoices = false;
      let currentChoice = null;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^(Lecture|DLA)\s+\d+/.test(trimmed)) continue;

        const choiceMatch = trimmed.match(/^([A-E])[.)]\s*(.*)/);
        if (choiceMatch) {
          inChoices = true;
          currentChoice = choiceMatch[1];
          choices[currentChoice] = choiceMatch[2].trim();
        } else if (inChoices && currentChoice) {
          choices[currentChoice] += " " + trimmed;
        } else if (!inChoices) {
          stemLines.push(trimmed);
        }
      }
      const stem = stemLines.join(" ").trim();

      let correct = null;
      const explanationParts = [];
      let inExplanation = false;

      const explLines = explPageText.split(/\n|\s{3,}/);
      for (const line of explLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const perChoiceMatch = trimmed.match(/^([A-E])[.)]\s*(.*)/);
        if (perChoiceMatch) {
          const letter = perChoiceMatch[1];
          const content = perChoiceMatch[2];
          if (
            /[Cc]orrect/.test(content) &&
            !/[Ii]ncorrect/.test(content.slice(0, 40))
          ) {
            correct = letter;
          }
          inExplanation = false;
          continue;
        }

        if (/^[Ee]xplanation[:\s]/.test(trimmed)) {
          inExplanation = true;
          const rest = trimmed.replace(/^[Ee]xplanation[:\s]*/, "").trim();
          if (rest) explanationParts.push(rest);
        } else if (inExplanation) {
          explanationParts.push(trimmed);
        }
      }

      const explanation = explanationParts.join(" ").trim();
      const lecMatch = stemPageText.match(/Lecture\s+\d+[^A-E\n]*/);
      const topic = lecMatch
        ? lecMatch[0].trim().slice(0, 60)
        : "FTM2 Review";

      questions.push({
        id: "q" + num,
        num,
        type: "clinical",
        imageQuestion: false,
        subject: "FTM2",
        topic,
        stem,
        choices,
        correct,
        explanation: explanation || "See explanation in original PDF.",
        difficulty: "medium",
      });
    }
  }

  return {
    questions,
    examTitle: file.name.replace(".pdf", ""),
    totalQuestions: questions.length,
  };
}
