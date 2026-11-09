// ============================================================
// JobAgent AI — Multi-API Client v2.1
// Updated models: Gemini 3.6 Flash, Groq Llama4, OpenRouter
// ============================================================

// ── All available models per provider ──────────────────────
const MODEL_CATALOG = {
  gemini: [
    { id: "gemini-3.6-flash",        label: "Gemini 3.6 Flash (Latest · Free)",    free: true  },
    { id: "gemini-3.5-flash",        label: "Gemini 3.5 Flash (Fast · Free)",       free: true  },
    { id: "gemini-3.5-flash-lite",   label: "Gemini 3.5 Flash-Lite (Fastest · Free)",free: true },
    { id: "gemini-3.1-pro-preview",  label: "Gemini 3.1 Pro (Most Capable · Paid)", free: false },
    { id: "gemini-2.5-flash",        label: "Gemini 2.5 Flash (Stable · Free)",     free: true  },
    { id: "gemini-2.5-pro",          label: "Gemini 2.5 Pro (High Quality · Paid)", free: false },
  ],
  groq: [
    { id: "llama-4-maverick-17b-128e-instruct", label: "Llama 4 Maverick (Best · Free)", free: true },
    { id: "llama-4-scout-17b-16e-instruct",     label: "Llama 4 Scout (Fast · Free)",    free: true },
    { id: "llama-3.3-70b-versatile",            label: "Llama 3.3 70B (Reliable · Free)",free: true },
    { id: "qwen3-32b",                          label: "Qwen3 32B (Smart · Free)",       free: true },
    { id: "kimi-k2-instruct",                   label: "Kimi K2 (Long Context · Free)",  free: true },
    { id: "deepseek-r1-distill-70b",            label: "DeepSeek R1 70B (Reasoning · Free)", free: true },
  ],
  openrouter: [
    { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (Free)",      free: true },
    { id: "google/gemma-3-27b-it:free",              label: "Gemma 3 27B (Free)",         free: true },
    { id: "qwen/qwen3-235b-a22b:free",               label: "Qwen3 235B (Free)",          free: true },
    { id: "deepseek/deepseek-r1-0528:free",          label: "DeepSeek R1 (Free)",         free: true },
    { id: "anthropic/claude-3.5-sonnet",             label: "Claude 3.5 Sonnet (Paid)",   free: false },
    { id: "openai/gpt-4o",                           label: "GPT-4o (Paid)",              free: false },
  ]
};

window.MODEL_CATALOG = MODEL_CATALOG;

// ── JSON safe parser ────────────────────────────────────────
function safeParseJSON(text) {
  if (!text) throw new Error("Empty AI response");
  try { return JSON.parse(text); } catch (_) {}
  const md = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) { try { return JSON.parse(md[1].trim()); } catch (_) {} }
  const obj = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (obj) { try { return JSON.parse(obj[1]); } catch (_) {} }
  throw new Error("Could not parse JSON from AI response: " + text.slice(0, 100));
}

// ── Provider callers ────────────────────────────────────────

async function callGemini(apiKey, model, systemPrompt, userPrompt, jsonMode) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
      ...(jsonMode ? { responseMimeType: "application/json" } : {})
    }
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini HTTP ${res.status}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error("Gemini returned empty response");
  return text;
}

async function callGroq(apiKey, model, systemPrompt, userPrompt, jsonMode) {
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt }
    ],
    temperature: 0.2,
    max_tokens: 2048,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {})
  };
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq HTTP ${res.status}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Groq returned empty response");
  return text;
}

async function callOpenRouter(apiKey, model, systemPrompt, userPrompt, jsonMode) {
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt }
    ],
    temperature: 0.2,
    max_tokens: 2048
  };
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://jobagentai.com",
      "X-Title": "JobAgent AI"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenRouter HTTP ${res.status}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OpenRouter returned empty response");
  return text;
}

// ── Core: call with fallback chain ──────────────────────────
async function callAI(settings, systemPrompt, userPrompt, jsonMode = false) {
  const errors = [];

  // Build provider chain from settings
  const chain = [];

  if (settings.geminiKey && settings.geminiModel) {
    chain.push({
      name: `Gemini (${settings.geminiModel})`,
      fn: () => callGemini(settings.geminiKey, settings.geminiModel, systemPrompt, userPrompt, jsonMode)
    });
  }
  if (settings.groqKey && settings.groqModel) {
    chain.push({
      name: `Groq (${settings.groqModel})`,
      fn: () => callGroq(settings.groqKey, settings.groqModel, systemPrompt, userPrompt, jsonMode)
    });
  }
  if (settings.openrouterKey && settings.openrouterModel) {
    chain.push({
      name: `OpenRouter (${settings.openrouterModel})`,
      fn: () => callOpenRouter(settings.openrouterKey, settings.openrouterModel, systemPrompt, userPrompt, jsonMode)
    });
  }

  if (chain.length === 0) throw new Error("NO_API_KEY");

  for (const provider of chain) {
    try {
      console.log(`[JobAgent AI] Trying ${provider.name}...`);
      const raw = await provider.fn();
      console.log(`[JobAgent AI] ✅ Success: ${provider.name}`);
      return jsonMode ? safeParseJSON(raw) : raw;
    } catch (err) {
      console.warn(`[JobAgent AI] ❌ ${provider.name}: ${err.message}`);
      errors.push(`${provider.name}: ${err.message}`);
      // Don't retry on auth errors
      if (err.message.includes("401") || err.message.toLowerCase().includes("invalid") && err.message.toLowerCase().includes("key")) {
        throw new Error(`API key rejected by ${provider.name}. Please check your key in Settings.`);
      }
    }
  }

  throw new Error(`All AI providers failed.\n${errors.join("\n")}`);
}

// ── Public AI functions ─────────────────────────────────────

async function aiChat(settings, profile, chatHistory, userMessage, pageContext) {
  const system = `You are JobAgent AI, a smart job application assistant built into a Chrome extension.
You help users auto-fill applications, write cover letters, tailor resumes, and find jobs.
Be concise, friendly, and helpful. Use **bold** for key terms. Keep responses under 200 words.

User: ${profile ? `${profile.fullName || "?"}, ${profile.currentTitle || "Job seeker"}, ${profile.yearsExperience || "?"} yrs exp` : "No profile yet"}
Page: ${pageContext?.title || "Unknown"} (${pageContext?.url || ""})`;

  const history = (chatHistory || []).slice(-6)
    .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  return await callAI(settings, system,
    `${history ? `${history}\n\n` : ""}User: ${userMessage}`, false);
}

async function aiDecideFields(settings, profile, fields, pageContext, chatHistory) {
  const system = `You are a job application form expert. Match form fields to the user's profile.
RULES: Only fill job-relevant fields. Never fabricate data not in the profile.
For SELECT, pick best matching option. Return ONLY a JSON array, no markdown.`;

  const prompt = `Profile:
${JSON.stringify(profile, null, 2)}

Page: ${pageContext?.title} | ${pageContext?.url}
Job: ${(pageContext?.jobDesc || "").slice(0, 500)}

Fields to fill (${fields.length} total):
${JSON.stringify(fields.slice(0, 30), null, 2)}

Return JSON array only:
[{"xpath":"","fieldName":"","value":"","confidence":"high|medium|low","reason":""}]
Only include fields where value is not null/empty.`;

  const result = await callAI(settings, system, prompt, true);
  return Array.isArray(result) ? result : (result?.fills || []);
}

async function aiParseResume(settings, resumeText) {
  const system = `You are a resume parser. Extract all information accurately. Return ONLY valid JSON.`;
  const prompt = `Parse this resume into JSON:
{
  "fullName":"","email":"","phone":"","location":"","linkedinUrl":"","portfolioUrl":"",
  "currentTitle":"","yearsExperience":"","summary":"","skills":[],
  "education":[{"degree":"","field":"","institution":"","year":""}],
  "experience":[{"title":"","company":"","duration":"","description":""}],
  "certifications":[],"languages":[],"visaStatus":"","salaryExpectation":"",
  "noticePeriod":"","workPreference":""
}
Resume text:
${resumeText.slice(0, 8000)}`;
  return await callAI(settings, system, prompt, true);
}

async function aiCoverLetter(settings, profile, jobContext) {
  const system = `You are an expert career coach. Write professional 3-paragraph cover letters.
Be specific, natural, and tailored. No generic filler. First person. Concise.`;
  const prompt = `Write a cover letter:
Applicant: ${profile.fullName}, ${profile.currentTitle}, ${profile.yearsExperience} years exp
Skills: ${(profile.skills || []).slice(0, 8).join(", ")}
Summary: ${profile.summary || ""}
Job: ${jobContext}`;
  return await callAI(settings, system, prompt, false);
}

async function aiTailorResume(settings, profile, jobDescription) {
  const system = `You are an ATS resume expert. Enhance bullet points to match the job. Never fabricate experience. Return JSON only.`;
  const prompt = `Tailor this profile for the job:
Name: ${profile.fullName}, Title: ${profile.currentTitle}
Summary: ${profile.summary}
Experience: ${JSON.stringify(profile.experience || [])}
Skills: ${(profile.skills || []).join(", ")}

Job Description: ${jobDescription.slice(0, 2000)}

Return JSON:
{"tailoredSummary":"","tailoredBullets":[{"original":"","tailored":""}],
"suggestedSkillsToHighlight":[],"matchScore":0,"missingKeywords":[],"strengthsForRole":[]}`;
  return await callAI(settings, system, prompt, true);
}

async function aiMatchScore(settings, profile, jobDescription, jobTitle, company) {
  const system = `You are a job-fit analyser. Rate candidate fit accurately. Return ONLY valid JSON.`;
  const prompt = `Rate this fit:
Candidate: ${profile.fullName}, ${profile.currentTitle}, ${profile.yearsExperience} yrs
Skills: ${(profile.skills || []).join(", ")}
Education: ${profile.education?.[0]?.degree || ""} - ${profile.education?.[0]?.institution || ""}

Job: ${jobTitle} at ${company}
Description: ${(jobDescription || "").slice(0, 1500)}

Return JSON:
{"matchScore":0,"verdict":"Excellent|Good|Fair|Poor","strengths":[],"gaps":[],"recommendation":""}`;
  return await callAI(settings, system, prompt, true);
}

async function aiAnswerQuestion(settings, profile, question, jobContext) {
  const system = `You are a job application coach. Write natural, concise answers (2-4 sentences). Sound human.`;
  const prompt = `Answer this application question as the candidate:
Question: "${question}"
Candidate: ${JSON.stringify(profile)}
Job Context: ${jobContext}`;
  return await callAI(settings, system, prompt, false);
}

window.AIClient = {
  callAI, aiChat, aiDecideFields, aiParseResume,
  aiCoverLetter, aiTailorResume, aiMatchScore, aiAnswerQuestion,
  safeParseJSON, MODEL_CATALOG
};
