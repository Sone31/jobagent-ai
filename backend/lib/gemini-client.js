// ============================================================
// JobAgent AI — Gemini Client (Node.js backend)
// ============================================================
const https = require("https");

async function callGemini(apiKey, model, systemPrompt, userPrompt, jsonMode = false) {
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
      ...(jsonMode ? { responseMimeType: "application/json" } : {})
    }
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/${model}:generateContent?key=${apiKey}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (!text) return reject(new Error("Empty response from Gemini"));
          if (jsonMode) {
            try { resolve(JSON.parse(text)); }
            catch {
              const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
              if (match) resolve(JSON.parse(match[1] || match[0]));
              else reject(new Error("Could not parse JSON from Gemini"));
            }
          } else {
            resolve(text);
          }
        } catch (e) { reject(e); }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Map form fields to profile values
async function decideFieldFills(apiKey, model, profile, fields, jobDescription) {
  const system = `You are an expert job application form-filling AI. Match form fields to the user's profile.
RULES: Never fabricate data. For SELECT fields pick best option. Return ONLY valid JSON array.`;

  const prompt = `Profile: ${JSON.stringify(profile)}

Job: ${(jobDescription || "").slice(0, 800)}

Fields to fill: ${JSON.stringify(fields.slice(0, 40))}

Return JSON array:
[{"xpath":"<xpath>","fieldName":"<name>","value":"<value>","confidence":"high|medium|low"}]
Only include non-null values.`;

  const result = await callGemini(apiKey, model, system, prompt, true);
  return Array.isArray(result) ? result : (result?.fills || []);
}

// Generate cover letter
async function generateCoverLetter(apiKey, model, profile, jobDescription, jobTitle, company) {
  const system = "You are an expert career coach. Write tailored, professional 3-paragraph cover letters. No filler. First person.";
  const prompt = `Write a cover letter for ${profile.fullName}, a ${profile.currentTitle} with ${profile.yearsExperience} years experience applying for ${jobTitle} at ${company}.
Skills: ${(profile.skills || []).join(", ")}
Summary: ${profile.summary}
Job Description: ${(jobDescription || "").slice(0, 1500)}`;
  return await callGemini(apiKey, model, system, prompt, false);
}

// Generate tailored resume markdown
async function tailorResumeMarkdown(apiKey, model, profile, jobDescription) {
  const system = `You are an ATS resume expert. Generate a complete tailored resume in clean Markdown format.
Never fabricate experience. Enhance wording to match job keywords.
Use these sections: # Name, ## Summary, ## Experience, ## Skills, ## Education`;

  const prompt = `Create a tailored resume in Markdown for:
Name: ${profile.fullName}
Title: ${profile.currentTitle}  
Experience: ${profile.yearsExperience} years
Skills: ${(profile.skills || []).join(", ")}
Summary: ${profile.summary}
Experience entries: ${JSON.stringify(profile.experience || [])}
Education: ${JSON.stringify(profile.education || [])}
Certifications: ${(profile.certifications || []).join(", ")}

Target Job Description:
${(jobDescription || "").slice(0, 2000)}

Output clean Markdown only. No extra text.`;

  return await callGemini(apiKey, model, system, prompt, false);
}

module.exports = { callGemini, decideFieldFills, generateCoverLetter, tailorResumeMarkdown };
