import { useMemo, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import "../styles/pages/EducationPage.css";

const buildEducationStructure = (t) => [
  {
    grade: t("education.grades.grade5"),
    subjects: [
      {
        name: t("education.subjects.math"),
        manuals: [
          { title: t("education.manuals.naturalNumbers"), type: t("education.types.manual"), updatedAt: t("education.planned") },
          { title: t("education.manuals.fractions"), type: t("education.types.sheet"), updatedAt: t("education.planned") },
        ],
      },
      {
        name: t("education.subjects.romanian"),
        manuals: [
          { title: t("education.manuals.narrativeText"), type: t("education.types.manual"), updatedAt: t("education.planned") },
          { title: t("education.manuals.speechParts"), type: t("education.types.sheet"), updatedAt: t("education.planned") },
        ],
      },
    ],
  },
  {
    grade: t("education.grades.grade8"),
    subjects: [
      {
        name: t("education.subjects.history"),
        manuals: [
          { title: t("education.manuals.modernRomania"), type: t("education.types.manual"), updatedAt: t("education.planned") },
          { title: t("education.manuals.examReview"), type: t("education.types.support"), updatedAt: t("education.planned") },
        ],
      },
      {
        name: t("education.subjects.geography"),
        manuals: [
          { title: t("education.manuals.romaniaMap"), type: t("education.types.atlas"), updatedAt: t("education.planned") },
          { title: t("education.manuals.climateRelief"), type: t("education.types.manual"), updatedAt: t("education.planned") },
        ],
      },
    ],
  },
  {
    grade: t("education.grades.grade12"),
    subjects: [
      {
        name: t("education.subjects.biology"),
        manuals: [
          { title: t("education.manuals.genetics"), type: t("education.types.manual"), updatedAt: t("education.planned") },
          { title: t("education.manuals.bacEssays"), type: t("education.types.collection"), updatedAt: t("education.planned") },
        ],
      },
      {
        name: t("education.subjects.computerScience"),
        manuals: [
          { title: t("education.manuals.algorithms"), type: t("education.types.manual"), updatedAt: t("education.planned") },
          { title: t("education.manuals.cppProblems"), type: t("education.types.collection"), updatedAt: t("education.planned") },
        ],
      },
    ],
  },
];

const EducationPage = () => {
  const { t } = useLanguage();
  const educationStructure = useMemo(() => buildEducationStructure(t), [t]);
  const [activeGrade, setActiveGrade] = useState(educationStructure[0].grade);
  const [activeSubject, setActiveSubject] = useState(educationStructure[0].subjects[0].name);
  const [searchTerm, setSearchTerm] = useState("");

  const gradeData = useMemo(
    () => educationStructure.find((grade) => grade.grade === activeGrade) || educationStructure[0],
    [activeGrade, educationStructure],
  );

  const subjectData = useMemo(
    () => gradeData.subjects.find((subject) => subject.name === activeSubject) || gradeData.subjects[0],
    [gradeData, activeSubject],
  );

  const filteredManuals = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return subjectData.manuals;
    return subjectData.manuals.filter((manual) => manual.title.toLowerCase().includes(query));
  }, [searchTerm, subjectData]);

  const handleGradeChange = (gradeName) => {
    setActiveGrade(gradeName);
    const nextGrade = educationStructure.find((grade) => grade.grade === gradeName) || educationStructure[0];
    setActiveSubject(nextGrade.subjects[0].name);
  };

  return (
    <section className="page-shell education-page mobile-shell">
      <header className="education-header mobile-card mobile-section-head">
        <div>
          <h1>{t("education.title")}</h1>
          <p>{t("education.description")}</p>
        </div>
        <button type="button" className="education-upload-btn">
          {t("education.actions.addManual")}
        </button>
      </header>

      <div className="education-search-row">
        <input
          type="search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder={t("education.searchPlaceholder")}
        />
      </div>

      <div className="education-grid">
        <aside className="education-card education-grades" data-tutorial="education-grades">
          <h2>{t("education.gradesTitle")}</h2>
          <div className="education-grade-list">
            {educationStructure.map((grade) => (
              <button
                key={grade.grade}
                type="button"
                className={grade.grade === activeGrade ? "active" : ""}
                onClick={() => handleGradeChange(grade.grade)}
              >
                <span>{grade.grade}</span>
                <small>{t("education.gradeCount", { count: grade.subjects.length })}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="education-card education-subjects" data-tutorial="education-subjects">
          <h2>{t("education.subjectsTitle", { grade: activeGrade })}</h2>
          <div className="education-subject-list">
            {gradeData.subjects.map((subject) => (
              <button
                key={subject.name}
                type="button"
                className={subject.name === activeSubject ? "active" : ""}
                onClick={() => setActiveSubject(subject.name)}
              >
                {subject.name}
              </button>
            ))}
          </div>
          <div className="education-subject-meta">
            <span>{t("education.currentSubject", { subject: subjectData.name })}</span>
            <span>{t("education.manualsReady", { count: subjectData.manuals.length })}</span>
          </div>
        </section>

        <section className="education-card education-manuals" data-tutorial="education-manuals">
          <div className="education-manual-header">
            <h2>{t("education.manualsTitle")}</h2>
            <span>{t("education.results", { count: filteredManuals.length })}</span>
          </div>

          <div className="education-manual-list">
            {filteredManuals.map((manual) => (
              <article key={`${subjectData.name}-${manual.title}`} className="education-manual-item">
                <div>
                  <h3>{manual.title}</h3>
                  <p>{subjectData.name}</p>
                </div>
                <div className="education-badges">
                  <span className="badge badge-type">{manual.type}</span>
                  <span className="badge badge-date">{manual.updatedAt}</span>
                </div>
              </article>
            ))}
            {!filteredManuals.length && (
              <p className="education-empty">{t("education.empty")}</p>
            )}
          </div>

          <div className="education-placeholder">
            <h3>{t("education.previewTitle")}</h3>
            <p>{t("education.previewBody")}</p>
            <button type="button">{t("education.actions.openManual")}</button>
          </div>
        </section>
      </div>
    </section>
  );
};

export default EducationPage;
