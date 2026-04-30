import { useEffect, useMemo, useState } from "react";
import { API_URL } from "../api/client";
import { useCrisisMode } from "../context/CrisisModeContext";
import { useLanguage } from "../i18n/LanguageContext";
import { readOfflineGuideIndex, writeOfflineGuideIndex } from "../utils/crisisMode";
import "../styles/pages/GuidePage.css";

const buildFallbackGuideData = (t) => [
  {
    categoryKey: "earthquake",
    category: t("guide.fallback.earthquake.category"),
    description: t("guide.fallback.earthquake.description"),
    situations: [
      {
        situationKey: "before-earthquake",
        name: t("guide.fallback.earthquake.before"),
        subcategories: [
          { subcategoryId: "evacuation-plan", title: t("guide.fallback.earthquake.evacuation"), pdf: "#", pdfByLanguage: { ro: "#", en: "#" } },
          { subcategoryId: "emergency-kit", title: t("guide.fallback.earthquake.kit"), pdf: "#", pdfByLanguage: { ro: "#", en: "#" } },
          { subcategoryId: "home-safety", title: t("guide.fallback.earthquake.home"), pdf: "#", pdfByLanguage: { ro: "#", en: "#" } },
        ],
      },
    ],
  },
];

const LEGACY_PDF_DEFAULT_LANGUAGE = "ro";
const SUPPORTED_GUIDE_LANGUAGES = new Set(["ro", "en"]);
const EN_CATEGORY_BY_KEY = {
  cutremur: "Earthquake",
  incendiu: "Fire",
  "prim-ajutor": "First Aid",
  earthquake: "Earthquake",
  fire: "Fire",
  "first-aid": "First Aid",
};

const EN_DESCRIPTION_BY_KEY = {
  cutremur: "Quick guides for safe actions during an earthquake.",
  incendiu: "Essential steps for prevention and action in case of fire.",
  "prim-ajutor": "Frequent medical situations and rapid intervention.",
  earthquake: "Quick guides for safe actions during an earthquake.",
  fire: "Essential steps for prevention and action in case of fire.",
  "first-aid": "Frequent medical situations and rapid intervention.",
};

const EN_SUBCATEGORY_BY_ID = {
  "seizmometru": "Seismometer",
  "siguranta-locuintei": "Home safety",
  "kit-de-urgenta": "Emergency kit",
  "ce-este-un-cutremur": "What is an earthquake?",
  "detectoare-si-extinctoare": "Detectors and extinguishers",
  "rute-de-evacuare": "Evacuation routes",
  "arsurile": "Burn injuries",
  "fracturi-si-entorse": "Fractures and sprains",
  "prim-ajutor": "First aid",
  "resuscitarea-cardio-respiratorie-rcp": "Cardiopulmonary resuscitation (CPR)",
};

const resolveGuidePdfForLanguage = (subcategory, language) => {
  if (!subcategory || typeof subcategory !== "object") return "";
  const lang = SUPPORTED_GUIDE_LANGUAGES.has(language) ? language : LEGACY_PDF_DEFAULT_LANGUAGE;
  const hasPdfByLanguage = subcategory.pdfByLanguage && typeof subcategory.pdfByLanguage === "object";
  if (hasPdfByLanguage) {
    const value = subcategory.pdfByLanguage?.[lang];
    return typeof value === "string" ? value.trim() : "";
  }
  if (lang === LEGACY_PDF_DEFAULT_LANGUAGE) {
    return typeof subcategory.pdf === "string" ? subcategory.pdf.trim() : "";
  }
  return "";
};

const GuidePage = () => {
  const { t, language } = useLanguage();
  const { isOfflineReady, markCriticalSync } = useCrisisMode();
  const fallbackGuideData = useMemo(() => buildFallbackGuideData(t), [t]);
  const [guideData, setGuideData] = useState(fallbackGuideData);
  const [activeCategoryKey, setActiveCategoryKey] = useState(fallbackGuideData[0].categoryKey);
  const [activeSituationKey, setActiveSituationKey] = useState(fallbackGuideData[0].situations[0].situationKey);
  const [activeSubcategoryId, setActiveSubcategoryId] = useState(fallbackGuideData[0].situations[0].subcategories[0].subcategoryId);
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadSubcategoryId, setUploadSubcategoryId] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [allowReplace, setAllowReplace] = useState(false);
  const [uploadLanguage, setUploadLanguage] = useState(() => (language === "en" ? "en" : "ro"));
  const [actionStatus, setActionStatus] = useState("");
  const [guideSource, setGuideSource] = useState("fallback");
  const [renameValue, setRenameValue] = useState("");
  const [isAddSubcategoryOpen, setIsAddSubcategoryOpen] = useState(false);
  const [newSubcategoryName, setNewSubcategoryName] = useState("");

  const categoryData = useMemo(() => {
    const found = guideData.find((item) => item.categoryKey === activeCategoryKey);
    return found || guideData[0];
  }, [guideData, activeCategoryKey]);

  const situationData = useMemo(() => {
    const found = (categoryData?.situations || []).find((item) => item.situationKey === activeSituationKey);
    return found || categoryData?.situations?.[0];
  }, [categoryData, activeSituationKey]);

  const filteredSubcategories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const list = situationData?.subcategories || [];
    if (!query) return list;
    return list.filter((item) => item.title.toLowerCase().includes(query));
  }, [searchQuery, situationData]);

  const activeSubcategoryData = useMemo(() => {
    const list = situationData?.subcategories || [];
    return list.find((item) => item.subcategoryId === activeSubcategoryId) || list[0] || null;
  }, [situationData, activeSubcategoryId]);

  useEffect(() => {
    if (!guideData.length) return;
    if (!guideData.some((item) => item.categoryKey === activeCategoryKey)) {
      const nextCategory = guideData[0];
      setActiveCategoryKey(nextCategory.categoryKey);
      const nextSituation = nextCategory.situations?.[0];
      if (nextSituation) {
        setActiveSituationKey(nextSituation.situationKey);
        setActiveSubcategoryId(nextSituation.subcategories?.[0]?.subcategoryId || "");
      }
    }
  }, [guideData, activeCategoryKey]);

  useEffect(() => {
    if (!categoryData) return;
    if (!(categoryData.situations || []).some((item) => item.situationKey === activeSituationKey)) {
      const nextSituation = categoryData.situations?.[0];
      if (nextSituation) {
        setActiveSituationKey(nextSituation.situationKey);
        setActiveSubcategoryId(nextSituation.subcategories?.[0]?.subcategoryId || "");
      }
    }
  }, [categoryData, activeSituationKey]);

  useEffect(() => {
    if (!situationData) return;
    if (!(situationData.subcategories || []).some((item) => item.subcategoryId === activeSubcategoryId)) {
      setActiveSubcategoryId(situationData.subcategories?.[0]?.subcategoryId || "");
    }
  }, [situationData, activeSubcategoryId]);

  useEffect(() => {
    setRenameValue(activeSubcategoryData?.title || "");
  }, [activeSubcategoryData]);

  useEffect(() => {
    setUploadLanguage(language === "en" ? "en" : "ro");
  }, [language]);

  useEffect(() => {
    const list = categoryData?.situations?.flatMap((item) => item.subcategories || []) || [];
    if (!list.length) {
      setUploadSubcategoryId("");
      return;
    }
    if (!uploadSubcategoryId || !list.some((item) => item.subcategoryId === uploadSubcategoryId)) {
      setUploadSubcategoryId(list[0].subcategoryId);
    }
  }, [categoryData, uploadSubcategoryId]);

  const applyGuideData = (data, source) => {
    setGuideData(data);
    setGuideSource(source);
  };

  useEffect(() => {
    let isMounted = true;
    const loadGuides = async () => {
      if (isOfflineReady) {
        const cached = readOfflineGuideIndex();
        if (!isMounted) return;
        applyGuideData(cached || fallbackGuideData, cached ? "cache" : "fallback");
        return;
      }
      try {
        const response = await fetch(`${API_URL}/api/guides`);
        if (!response.ok) throw new Error("Guides API unavailable");
        const payload = await response.json();
        const data = Array.isArray(payload?.data) && payload.data.length ? payload.data : null;
        if (!isMounted) return;
        if (data) {
          applyGuideData(data, "live");
          writeOfflineGuideIndex(data);
          markCriticalSync();
        }
      } catch {
        const cached = readOfflineGuideIndex();
        if (!isMounted) return;
        applyGuideData(cached || fallbackGuideData, cached ? "cache" : "fallback");
      }
    };
    loadGuides();
    return () => {
      isMounted = false;
    };
  }, [fallbackGuideData, isOfflineReady, markCriticalSync]);

  const refreshGuideData = async ({ clearActiveSubcategory = false } = {}) => {
    if (clearActiveSubcategory) setActiveSubcategoryId("");
    try {
      const response = await fetch(`${API_URL}/api/guides`);
      if (!response.ok) return;
      const payload = await response.json();
      if (Array.isArray(payload?.data) && payload.data.length) {
        setGuideData(payload.data);
        setGuideSource("live");
        writeOfflineGuideIndex(payload.data);
        markCriticalSync();
      }
    } catch {
      // ignore
    }
  };

  const categoryCounts = useMemo(() => {
    const next = new Map();
    for (const category of guideData) {
      let totalCount = 0;
      let uploadedCount = 0;
      for (const situation of category.situations || []) {
        for (const subcategory of situation.subcategories || []) {
          totalCount += 1;
          if (resolveGuidePdfForLanguage(subcategory, language)) uploadedCount += 1;
        }
      }
      next.set(category.categoryKey, { totalCount, uploadedCount });
    }
    return next;
  }, [guideData, language]);

  const resolvePdfUrl = (pdfPath) => {
    if (!pdfPath) return "";
    if (/^https?:\/\//i.test(pdfPath)) return pdfPath;
    return `${API_URL}${pdfPath}`;
  };
  const localizeCategory = (item) =>
    language === "en" ? EN_CATEGORY_BY_KEY[item?.categoryKey] || item?.category || "" : item?.category || "";
  const localizeDescription = (item) =>
    language === "en" ? EN_DESCRIPTION_BY_KEY[item?.categoryKey] || item?.description || "" : item?.description || "";
  const localizeSubcategory = (item) =>
    language === "en" ? EN_SUBCATEGORY_BY_ID[item?.subcategoryId] || item?.title || "" : item?.title || "";

  const buildCategoryRenderKey = (item, index) => `${item?.categoryKey || item?.category || "category"}-${index}`;
  const buildSubcategoryRenderKey = (item, index) =>
    `${item?.subcategoryId || item?.title || "subcategory"}-${index}`;

  const uploadSubcategories = categoryData?.situations?.flatMap((item) => item.subcategories || []) || [];
  const uploadSubcategory = uploadSubcategories.find((item) => item.subcategoryId === uploadSubcategoryId) || uploadSubcategories[0] || null;

  const handleCategoryChange = (categoryKey) => {
    setActiveCategoryKey(categoryKey);
    const nextCategory = guideData.find((item) => item.categoryKey === categoryKey) || guideData[0];
    const nextSituation = nextCategory?.situations?.[0];
    if (nextSituation) {
      setActiveSituationKey(nextSituation.situationKey);
      setActiveSubcategoryId(nextSituation.subcategories?.[0]?.subcategoryId || "");
    }
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!uploadFile) return setUploadStatus(t("guide.upload.choosePdf"));
    if (!categoryData?.categoryKey || !situationData?.situationKey || !uploadSubcategory?.subcategoryId) {
      return setUploadStatus(t("guide.upload.completeFields"));
    }
    setIsUploading(true);
    setUploadStatus("");
    try {
      const formData = new FormData();
      formData.append("categoryKey", categoryData.categoryKey);
      formData.append("situationKey", situationData.situationKey);
      formData.append("subcategoryId", uploadSubcategory.subcategoryId);
      formData.append("language", uploadLanguage);
      formData.append("replace", allowReplace ? "true" : "false");
      formData.append("file", uploadFile);
      const response = await fetch(`${API_URL}/api/guides/upload${allowReplace ? "?replace=true" : ""}`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || t("guide.upload.failed"));
      setUploadStatus(t("guide.upload.success"));
      setUploadFile(null);
      await refreshGuideData();
    } catch (err) {
      setUploadStatus(err.message || t("guide.upload.error"));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeletePdf = async () => {
    setActionStatus("");
    try {
      const response = await fetch(`${API_URL}/api/guides/remove-pdf`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryKey: categoryData?.categoryKey,
          situationKey: situationData?.situationKey,
          subcategoryId: activeSubcategoryData?.subcategoryId,
          language: language === "en" ? "en" : "ro",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || t("guide.states.deletePdfError"));
      setActionStatus(t("guide.states.pdfDeleted"));
      await refreshGuideData();
    } catch (err) {
      setActionStatus(err.message || t("guide.states.deletePdfError"));
    }
  };

  const handleDeleteSubcategory = async () => {
    setActionStatus("");
    try {
      const response = await fetch(`${API_URL}/api/guides/delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryKey: categoryData?.categoryKey,
          situationKey: situationData?.situationKey,
          subcategoryId: activeSubcategoryData?.subcategoryId,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || t("guide.states.deleteSubcategoryError"));
      setActionStatus(t("guide.states.subcategoryDeleted"));
      await refreshGuideData({ clearActiveSubcategory: true });
    } catch (err) {
      setActionStatus(err.message || t("guide.states.deleteSubcategoryError"));
    }
  };

  const handleRename = async () => {
    const nextTitle = renameValue.trim();
    if (!nextTitle) return setActionStatus(t("guide.states.enterNewName"));
    try {
      const response = await fetch(`${API_URL}/api/guides/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryKey: categoryData?.categoryKey,
          situationKey: situationData?.situationKey,
          subcategoryId: activeSubcategoryData?.subcategoryId,
          newTitle: nextTitle,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || t("guide.states.renameError"));
      setActionStatus(t("guide.states.renamed"));
      await refreshGuideData();
    } catch (err) {
      setActionStatus(err.message || t("guide.states.renameError"));
    }
  };

  const handleCreateSubcategory = async () => {
    const nextTitle = newSubcategoryName.trim();
    if (!nextTitle) return setActionStatus(t("guide.states.enterSubcategory"));
    try {
      const response = await fetch(`${API_URL}/api/guides/subcategory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryKey: categoryData?.categoryKey,
          situationKey: situationData?.situationKey,
          subcategoryTitle: nextTitle,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || t("guide.states.addError"));
      setActionStatus(t("guide.states.added"));
      setIsAddSubcategoryOpen(false);
      setNewSubcategoryName("");
      await refreshGuideData();
    } catch (err) {
      setActionStatus(err.message || t("guide.states.addError"));
    }
  };

  const activeLanguagePdf = useMemo(() => resolveGuidePdfForLanguage(activeSubcategoryData, language), [activeSubcategoryData, language]);

  return (
    <section className="page-shell guide-page mobile-shell">
      <div className={`guide-source-strip source-${guideSource}`} aria-live="polite">
        {t("guide.source.label", { source: t(`guide.source.${guideSource === "cache" ? "cache" : guideSource === "live" ? "live" : "fallback"}`) })}
      </div>
      <div className="guide-search-row" data-tutorial="guide-search">
        <input type="search" placeholder={t("guide.search.placeholder")} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} aria-label={t("guide.search.aria")} />
      </div>
      <div className="guide-grid">
        <div className="guide-left">
          <aside className="guide-card guide-categories" data-tutorial="guide-categories">
            <h2>{t("guide.categories.title")}</h2>
            <div className="category-list">
              {guideData.map((item, index) => (
                <button key={buildCategoryRenderKey(item, index)} type="button" className={item.categoryKey === categoryData?.categoryKey ? "active" : ""} onClick={() => handleCategoryChange(item.categoryKey)} aria-pressed={item.categoryKey === categoryData?.categoryKey}>
                  <span>{localizeCategory(item)}</span>
                  <small>{`${categoryCounts.get(item.categoryKey)?.uploadedCount || 0}/${categoryCounts.get(item.categoryKey)?.totalCount || 0}`}</small>
                </button>
              ))}
            </div>
            <div className="subcategory-select">
              <label htmlFor="subcategory">{t("guide.categories.label")}</label>
              <select id="subcategory" value={filteredSubcategories.length ? activeSubcategoryData?.subcategoryId || "" : ""} onChange={(event) => setActiveSubcategoryId(event.target.value)} aria-label={t("guide.categories.selectAria")}>
                {filteredSubcategories.length ? filteredSubcategories.map((item, index) => (
                  <option key={buildSubcategoryRenderKey(item, index)} value={item.subcategoryId}>{localizeSubcategory(item)}</option>
                )) : <option value="" disabled>{t("guide.categories.noMatches")}</option>}
              </select>
            </div>
          </aside>
          <aside className="guide-card guide-upload" data-tutorial="guide-upload">
            <h2>{t("guide.upload.title")}</h2>
            <form className="upload-form" onSubmit={handleUpload}>
              <label className="upload-field"><span>{t("guide.upload.category")}</span><input value={localizeCategory(categoryData)} readOnly /></label>
              <label className="upload-field">
                <span>{t("guide.upload.subcategory")}</span>
                <select value={uploadSubcategory?.subcategoryId || ""} onChange={(event) => setUploadSubcategoryId(event.target.value)} aria-label={t("guide.upload.selectAria")}>
                  {uploadSubcategories.length ? uploadSubcategories.map((sub, index) => <option key={buildSubcategoryRenderKey(sub, index)} value={sub.subcategoryId}>{localizeSubcategory(sub)}</option>) : <option value="" disabled>{t("guide.upload.noSubcategories")}</option>}
                </select>
              </label>
              <label className="upload-field"><span>{t("guide.upload.pdf")}</span><input type="file" accept="application/pdf" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} /></label>
              <label className="upload-field"><span>{t("account.language")}</span><select value={uploadLanguage} onChange={(event) => setUploadLanguage(event.target.value === "en" ? "en" : "ro")}><option value="ro">Romana</option><option value="en">English</option></select></label>
              <label className="upload-check"><input type="checkbox" checked={allowReplace} onChange={(event) => setAllowReplace(event.target.checked)} />{t("guide.upload.replace")}</label>
              <button type="submit" disabled={isUploading}>{isUploading ? t("guide.upload.uploading") : t("guide.upload.button")}</button>
              <p className="upload-status">{t("guide.upload.languageStatus", { language: uploadLanguage.toUpperCase(), mode: allowReplace ? t("guide.upload.modeOverwrite") : t("guide.upload.modeNewUpload") })}</p>
              {uploadStatus && <p className="upload-status">{uploadStatus}</p>}
            </form>
          </aside>
        </div>
        <section className="guide-card guide-details" data-tutorial="guide-details">
          <div className="guide-breadcrumb"><span>{localizeCategory(categoryData)}</span><span className="guide-divider">/</span><span>{localizeSubcategory(activeSubcategoryData)}</span></div>
          <p className="guide-description">{localizeDescription(categoryData)}</p>
          <div className="guide-actions">
            <button type="button" className="action-btn danger" onClick={handleDeletePdf}>{t("guide.actions.deletePdf")}</button>
            <button type="button" className="action-btn danger" onClick={handleDeleteSubcategory}>{t("guide.actions.deleteSubcategory")}</button>
            <button type="button" className="action-btn" onClick={() => setIsAddSubcategoryOpen(true)}>{t("guide.actions.addSubcategory")}</button>
            <div className="action-rename"><input type="text" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} placeholder={t("guide.actions.newNamePlaceholder")} /><button type="button" className="action-btn" onClick={handleRename}>{t("guide.actions.rename")}</button></div>
          </div>
          {actionStatus && <p className="action-status">{actionStatus}</p>}
          {activeLanguagePdf ? <div className="guide-preview"><iframe title={`PDF ${localizeSubcategory(activeSubcategoryData) || ""}`} src={resolvePdfUrl(activeLanguagePdf)} /></div> : <p className="action-status">{t("guide.states.noPdfForLanguage", { language: language === "en" ? "EN" : "RO" })}</p>}
        </section>
      </div>
      {isAddSubcategoryOpen && (
        <div className="guide-modal-backdrop" role="presentation">
          <div className="guide-modal" role="dialog" aria-modal="true" aria-label={t("guide.modal.aria")}>
            <h3>{t("guide.modal.title")}</h3>
            <p>{t("guide.modal.body", { category: localizeCategory(categoryData) || "" })}</p>
            <input type="text" value={newSubcategoryName} onChange={(event) => setNewSubcategoryName(event.target.value)} placeholder={t("guide.modal.placeholder")} autoFocus />
            <div className="modal-actions">
              <button type="button" className="action-btn" onClick={handleCreateSubcategory}>{t("common.actions.save")}</button>
              <button type="button" className="action-btn danger" onClick={() => { setIsAddSubcategoryOpen(false); setNewSubcategoryName(""); }}>{t("common.actions.cancel")}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default GuidePage;
