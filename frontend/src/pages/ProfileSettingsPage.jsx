import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import apiClient from "../api/client";
import { useAccessibility } from "../context/AccessibilityContext";
import { useLanguage } from "../i18n/LanguageContext";
import { clearAuthSession } from "../utils/authSession";

import "../styles/pages/ProfileSettingsPage.css";

const EMPTY_INCLUSION_PROFILE = {
  consentForEmergencyUse: false,
  mobilityNeeds: [],
  sensoryNeeds: [],
  communicationNeeds: [],
  medicalFlags: [],
  supportContacts: [],
  shortNotes: "",
};

const INCLUSION_OPTIONS = {
  mobilityNeeds: ["reduced_mobility", "wheelchair", "needs_transport_assistance"],
  sensoryNeeds: ["low_vision", "hard_of_hearing", "deaf"],
  communicationNeeds: ["prefers_text", "prefers_voice", "simple_language", "needs_interpreter"],
  medicalFlags: ["critical_medication", "uses_medical_device", "allergy_risk"],
};

const RELATIONSHIP_OPTIONS = [
  "family",
  "caregiver",
  "friend",
  "neighbor",
  "doctor",
  "social_worker",
  "other",
];

const buildInclusionOptions = (t) =>
  Object.fromEntries(
    Object.entries(INCLUSION_OPTIONS).map(([field, values]) => [
      field,
      values.map((value) => ({
        value,
        label: t(`profileSettings.inclusionOptions.${value}`),
      })),
    ]),
  );

const buildRelationshipOptions = (t) =>
  RELATIONSHIP_OPTIONS.map((value) => ({
    value,
    label: t(`profileSettings.relationships.${value}`),
  }));

const ProfileSettingsPage = () => {
  const { t, locale } = useLanguage();
  const { isQuickA11yEnabled, setQuickA11yEnabled } = useAccessibility();
  const [user, setUser] = useState(null);
  const [guestMode, setGuestMode] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [preview, setPreview] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [inclusionProfile, setInclusionProfile] = useState(EMPTY_INCLUSION_PROFILE);
  const [savingInclusion, setSavingInclusion] = useState(false);
  const [inclusionMessage, setInclusionMessage] = useState("");
  const navigate = useNavigate();
  const inclusionOptions = useMemo(() => buildInclusionOptions(t), [t]);
  const relationshipOptions = useMemo(() => buildRelationshipOptions(t), [t]);

  useEffect(() => {
    const currentUser = localStorage.getItem("currentUser");
    if (!currentUser) {
      setUser(null);
      setGuestMode(true);
      setPreview(null);
      setInitialized(true);
      return;
    }

    try {
      const parsedUser = JSON.parse(currentUser);
      setUser(parsedUser);
      setGuestMode(false);
      setInclusionProfile({
        ...EMPTY_INCLUSION_PROFILE,
        ...(parsedUser.inclusionProfile || {}),
        supportContacts: Array.isArray(parsedUser.inclusionProfile?.supportContacts)
          ? parsedUser.inclusionProfile.supportContacts
          : [],
      });
      if (parsedUser.profilePicture) {
        setPreview(parsedUser.profilePicture);
      }
    } catch (err) {
      console.error("Eroare parsare currentUser:", err);
      clearAuthSession({ reason: "invalid_local_user_json", dispatchLogout: false });
      setUser(null);
      setGuestMode(true);
      setPreview(null);
    }
    setInitialized(true);
  }, [navigate]);

  useEffect(() => {
    const refresh = () => {
      const raw = localStorage.getItem("currentUser");
      if (!raw) {
        setUser(null);
        setGuestMode(true);
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        setUser(parsed);
        setInclusionProfile({
          ...EMPTY_INCLUSION_PROFILE,
          ...(parsed.inclusionProfile || {}),
          supportContacts: Array.isArray(parsed.inclusionProfile?.supportContacts)
            ? parsed.inclusionProfile.supportContacts
            : [],
        });
        setGuestMode(false);
      } catch {
        setGuestMode(true);
      }
    };
    window.addEventListener("loginSuccess", refresh);
    window.addEventListener("logoutSuccess", refresh);
    return () => {
      window.removeEventListener("loginSuccess", refresh);
      window.removeEventListener("logoutSuccess", refresh);
    };
  }, []);

  if (!initialized) {
    return <div className="loading">{t("profileSettings.states.loading")}</div>;
  }

  if (guestMode) {
    return (
      <div className="profile-settings-page mobile-shell">
        <div className="profile-settings-card profile-settings-guest" data-tutorial="profile-state">
          <h1>{t("profileSettings.guestTitle")}</h1>
          <p className="description">
            {t("profileSettings.guestDescription")}
          </p>
          <div className="guest-actions">
            <button
              type="button"
              className="guest-btn primary"
              onClick={() => window.dispatchEvent(new Event("openLoginModal"))}
            >
              {t("auth.actions.signIn")}
            </button>
            <button
              type="button"
              className="guest-btn secondary"
              onClick={() => window.dispatchEvent(new Event("openSignUpModal"))}
            >
              {t("auth.actions.signUp")}
            </button>
            <button type="button" className="guest-btn link" onClick={() => navigate("/")}>
              {t("profileSettings.actions.backDashboard")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <div className="loading">{t("profileSettings.states.profileLoading")}</div>;
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setPreview(URL.createObjectURL(file));
      setMessage("");
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setMessage(t("profileSettings.states.selectImage"));
      return;
    }
    setUploading(true);
    setMessage("");

    const formData = new FormData();
    formData.append("profilePicture", selectedFile);
    try {
      const response = await apiClient.post("/api/profile-picture", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const data = response?.data || null;

      if (data) {
        const returnedPicture =
          data?.profilePicture ||
          data?.user?.profilePicture ||
          preview ||
          user?.profilePicture ||
          null;

        // actualizăm user-ul cu base64-ul returnat de backend
        const updatedUser = {
          ...user,
          ...(data?.user && typeof data.user === "object" ? data.user : {}),
          profilePicture: returnedPicture,
        };

        setUser(updatedUser);
        setPreview(returnedPicture);
        setSelectedFile(null);

        // salvăm și în localStorage ca să persiste după refresh
        localStorage.setItem("currentUser", JSON.stringify(updatedUser));
        window.dispatchEvent(new Event("profilePictureUpdated"));

        setMessage(t("profileSettings.states.pictureSuccess"));
      } else {
        setMessage(t("profileSettings.states.unknownServer"));
      }
    } catch (err) {
      console.error("Eroare la upload:", err);
      setMessage(err.response?.data?.error || t("profileSettings.states.uploadError"));
    } finally {
      setUploading(false);
    }
  };

  const updateCurrentUserInStorage = (nextUser) => {
    localStorage.setItem("currentUser", JSON.stringify(nextUser));
    window.dispatchEvent(new Event("profileUpdated"));
  };

  const toggleInclusionValue = (field, value) => {
    setInclusionMessage("");
    setInclusionProfile((current) => {
      const existing = Array.isArray(current[field]) ? current[field] : [];
      return {
        ...current,
        [field]: existing.includes(value)
          ? existing.filter((item) => item !== value)
          : [...existing, value],
      };
    });
  };

  const updateSupportContact = (index, field, value) => {
    setInclusionMessage("");
    setInclusionProfile((current) => {
      const contacts = [...(Array.isArray(current.supportContacts) ? current.supportContacts : [])];
      contacts[index] = {
        ...(contacts[index] || { relationship: "family" }),
        [field]: value,
      };
      return { ...current, supportContacts: contacts };
    });
  };

  const addSupportContact = () => {
    setInclusionProfile((current) => ({
      ...current,
      supportContacts: [
        ...(Array.isArray(current.supportContacts) ? current.supportContacts : []),
        { name: "", phone: "", relationship: "family" },
      ].slice(0, 3),
    }));
  };

  const removeSupportContact = (index) => {
    setInclusionProfile((current) => ({
      ...current,
      supportContacts: (Array.isArray(current.supportContacts) ? current.supportContacts : []).filter((_, idx) => idx !== index),
    }));
  };

  const saveInclusionProfile = async () => {
    setSavingInclusion(true);
    setInclusionMessage("");
    try {
      const payload = {
        ...inclusionProfile,
        shortNotes: String(inclusionProfile.shortNotes || "").slice(0, 160),
        supportContacts: (Array.isArray(inclusionProfile.supportContacts) ? inclusionProfile.supportContacts : [])
          .map((contact) => ({
            name: String(contact.name || "").slice(0, 80),
            phone: String(contact.phone || "").slice(0, 32),
            relationship: contact.relationship || "other",
          }))
          .filter((contact) => contact.name.trim() || contact.phone.trim()),
      };
      const response = await apiClient.put("/api/me/inclusion-profile", payload);
      const nextProfile = {
        ...EMPTY_INCLUSION_PROFILE,
        ...(response.data?.inclusionProfile || {}),
        supportContacts: Array.isArray(response.data?.inclusionProfile?.supportContacts)
          ? response.data.inclusionProfile.supportContacts
          : [],
      };
      setInclusionProfile(nextProfile);
      const updatedUser = { ...user, inclusionProfile: nextProfile };
      setUser(updatedUser);
      updateCurrentUserInStorage(updatedUser);
      setInclusionMessage(t("profileSettings.states.safetySaved"));
    } catch (err) {
      setInclusionMessage(err.response?.data?.error || t("profileSettings.states.safetySaveError"));
    } finally {
      setSavingInclusion(false);
    }
  };

  const deleteInclusionProfile = async () => {
    const confirmed = window.confirm(t("profileSettings.states.safetyDeleteConfirm"));
    if (!confirmed) return;
    setSavingInclusion(true);
    setInclusionMessage("");
    try {
      await apiClient.delete("/api/me/inclusion-profile");
      setInclusionProfile(EMPTY_INCLUSION_PROFILE);
      const updatedUser = { ...user };
      delete updatedUser.inclusionProfile;
      setUser(updatedUser);
      updateCurrentUserInStorage(updatedUser);
      setInclusionMessage(t("profileSettings.states.safetyDeleted"));
    } catch (err) {
      setInclusionMessage(err.response?.data?.error || t("profileSettings.states.safetyDeleteError"));
    } finally {
      setSavingInclusion(false);
    }
  };

  return (
    <div className="profile-settings-page mobile-shell">
      <div className="profile-settings-card" data-tutorial="profile-state">
        <h1>{t("profileSettings.title")}</h1>
        <p className="description">
          {t("profileSettings.description")}
        </p>

        <div className="user-info-section" data-tutorial="profile-account">
          <h2>{t("profileSettings.account.title")}</h2>
          <div className="info-row">
            <span className="label">{t("profileSettings.account.email")}:</span>
            <span className="value">{user.email}</span>
          </div>
          <div className="info-row">
            <span className="label">{t("profileSettings.account.userId")}:</span>
            <span className="value">{user.id || user._id || "—"}</span>
          </div>
          <div className="info-row">
            <span className="label">{t("profileSettings.account.registeredAt")}:</span>
            <span className="value">
              {user.createdAt
                ? new Date(user.createdAt).toLocaleString(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : "—"}
            </span>
          </div>
        </div>

        <div className="quick-a11y-section" data-tutorial="profile-quick-a11y">
          <div className="quick-a11y-copy">
            <h2>{t("profileSettings.quickA11y.title")}</h2>
            <p>{t("profileSettings.quickA11y.description")}</p>
          </div>
          <label className="quick-a11y-toggle">
            <input
              type="checkbox"
              checked={isQuickA11yEnabled === true}
              onChange={(event) => setQuickA11yEnabled(event.target.checked)}
            />
            <span>{isQuickA11yEnabled ? t("profileSettings.quickA11y.on") : t("profileSettings.quickA11y.off")}</span>
          </label>
        </div>

        {/* Secțiune Poză de Profil */}
        <div className="profile-picture-section" data-tutorial="profile-picture">
          <h2>{t("profileSettings.picture.title")}</h2>

          <div className="profile-picture-layout">
            {/* Preview */}
            <div className="profile-picture-preview">
              {preview ? (
                <img
                  src={preview}
                  alt={t("profileSettings.picture.previewAlt")}
                  className="profile-picture-image"
                />
              ) : (
                <span className="profile-picture-placeholder">?</span>
              )}
            </div>

            {/* Input + buton */}
            <div className="profile-picture-actions">
              <input
                className="profile-file-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
                disabled={uploading}
              />

              {selectedFile && (
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={uploading}
                  className="profile-upload-btn"
                >
                  {uploading ? t("profileSettings.states.pictureUploading") : t("profileSettings.actions.savePicture")}
                </button>
              )}

              {message && (
                <p className={`profile-upload-message ${message.includes("succes") ? "success" : "error"}`}>
                  {message}
                </p>
              )}
            </div>
          </div>

          <p className="profile-picture-note">
            {t("profileSettings.picture.note")}
          </p>
        </div>

        <div className="inclusion-profile-section">
          <div className="inclusion-profile-head">
            <div>
              <h2>{t("profileSettings.inclusion.title")}</h2>
              <p>{t("profileSettings.inclusion.description")}</p>
            </div>
            <label className="inclusion-consent">
              <input
                type="checkbox"
                checked={inclusionProfile.consentForEmergencyUse === true}
                onChange={(event) =>
                  setInclusionProfile((current) => ({
                    ...current,
                    consentForEmergencyUse: event.target.checked,
                  }))
                }
              />
              {t("profileSettings.inclusion.consent")}
            </label>
          </div>

          <div className="inclusion-grid">
            {Object.entries(inclusionOptions).map(([field, options]) => (
              <fieldset key={field} className="inclusion-group">
                <legend>{t(`profileSettings.inclusion.groups.${field}`)}</legend>
                {options.map(({ value, label }) => (
                  <label key={value} className="inclusion-check">
                    <input
                      type="checkbox"
                      checked={(inclusionProfile[field] || []).includes(value)}
                      onChange={() => toggleInclusionValue(field, value)}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>

          <div className="support-contacts">
            <div className="support-contacts-head">
              <h3>{t("profileSettings.inclusion.supportContacts")}</h3>
              <button type="button" onClick={addSupportContact} disabled={(inclusionProfile.supportContacts || []).length >= 3}>
                {t("profileSettings.actions.addContact")}
              </button>
            </div>
            {(inclusionProfile.supportContacts || []).map((contact, index) => (
              <div key={`support-${index}`} className="support-contact-row">
                <input
                  type="text"
                  placeholder={t("profileSettings.inclusion.namePlaceholder")}
                  value={contact.name || ""}
                  maxLength={80}
                  onChange={(event) => updateSupportContact(index, "name", event.target.value)}
                />
                <select
                  value={contact.relationship || "other"}
                  onChange={(event) => updateSupportContact(index, "relationship", event.target.value)}
                >
                  {relationshipOptions.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <input
                  type="tel"
                  placeholder={t("profileSettings.inclusion.phonePlaceholder")}
                  value={contact.phone || ""}
                  maxLength={32}
                  onChange={(event) => updateSupportContact(index, "phone", event.target.value)}
                />
                <button type="button" className="remove-support-contact" onClick={() => removeSupportContact(index)}>
                  {t("profileSettings.inclusion.remove")}
                </button>
              </div>
            ))}
          </div>

          <label className="inclusion-notes">
            {t("profileSettings.inclusion.noteLabel")}
            <textarea
              value={inclusionProfile.shortNotes || ""}
              maxLength={160}
              rows={3}
              placeholder={t("profileSettings.inclusion.notePlaceholder")}
              onChange={(event) =>
                setInclusionProfile((current) => ({ ...current, shortNotes: event.target.value.slice(0, 160) }))
              }
            />
            <span>{String(inclusionProfile.shortNotes || "").length}/160</span>
          </label>

          <div className="inclusion-actions">
            <button type="button" className="profile-upload-btn" onClick={() => void saveInclusionProfile()} disabled={savingInclusion}>
              {savingInclusion ? t("profileSettings.states.saving") : t("profileSettings.actions.saveSafety")}
            </button>
            <button type="button" className="delete-safety-data-btn" onClick={() => void deleteInclusionProfile()} disabled={savingInclusion}>
              {t("profileSettings.actions.deleteSafety")}
            </button>
          </div>
          {inclusionMessage && <p className="profile-upload-message">{inclusionMessage}</p>}
        </div>

        {/* Secțiune viitoare */}
        <div className="coming-soon">
          <p>{t("profileSettings.comingSoon")}</p>
        </div>
      </div>
    </div>
  );
};

export default ProfileSettingsPage;
