/**
 * @typedef {"top" | "right" | "bottom" | "left" | "center"} TutorialPlacement
 */

/** @type {Array<{
 *   id: string,
 *   title: string,
 *   titleKey?: string,
 *   description: string,
 *   descriptionKey?: string,
 *   routeMatcher: string | RegExp | ((pathname: string) => boolean),
 *   steps: Array<{
 *     title: string,
 *     titleKey?: string,
 *     description: string,
 *     descriptionKey?: string,
 *     selector?: string,
 *     placement?: TutorialPlacement
 *   }>
 * }>} */
const TUTORIALS = [
  {
    id: "dashboard",
    title: "Dashboard walkthrough",
    titleKey: "tutorial.dashboard.title",
    description: "Panoul principal iti arata rapid nivelul de risc, actiunile recomandate si semnalele din jurul tau.",
    descriptionKey: "tutorial.dashboard.description",
    routeMatcher: (pathname) => pathname === "/" || pathname === "/dashboard",
    steps: [
      { title: "Hero overview", titleKey: "tutorial.dashboard.steps.hero.title", description: "Aici vezi rezumatul situatiei personale, plus scurtaturi rapide catre map si guide.", descriptionKey: "tutorial.dashboard.steps.hero.description", selector: '[data-tutorial="dashboard-hero-overview"]', placement: "bottom" },
      { title: "Risk score", titleKey: "tutorial.dashboard.steps.risk.title", description: "Cardul de risc explica nivelul curent, trendul si ultima actualizare disponibila.", descriptionKey: "tutorial.dashboard.steps.risk.description", selector: '[data-tutorial="dashboard-risk-card"]', placement: "left" },
      { title: "Offline essentials", titleKey: "tutorial.dashboard.steps.offline.title", description: "Aceasta zona pastreaza actiunile critice, locatia salvata si starea datelor atunci cand conexiunea sau sincronizarea nu sunt perfecte.", descriptionKey: "tutorial.dashboard.steps.offline.description", selector: '[data-tutorial="dashboard-offline-essentials"]', placement: "bottom" },
      { title: "Preparedness steps", titleKey: "tutorial.dashboard.steps.preparedness.title", description: "Taburile de pregatire impart actiunile recomandate in pasi usor de urmarit.", descriptionKey: "tutorial.dashboard.steps.preparedness.description", selector: '[data-tutorial="dashboard-preparedness"]', placement: "right" },
      { title: "Important news", titleKey: "tutorial.dashboard.steps.news.title", description: "Aici gasesti stirile si semnalele de criza care influenteaza contextul operational.", descriptionKey: "tutorial.dashboard.steps.news.description", selector: '[data-tutorial="dashboard-news"]', placement: "left" },
      { title: "Risk drivers", titleKey: "tutorial.dashboard.steps.drivers.title", description: "Driverii iti arata de ce s-a schimbat scorul si care factori au cel mai mare impact.", descriptionKey: "tutorial.dashboard.steps.drivers.description", selector: '[data-tutorial="dashboard-drivers"]', placement: "top" },
      { title: "Regional factors", titleKey: "tutorial.dashboard.steps.regional.title", description: "Lista de jos arata factorii regionali folositi ca semnale live sau fallback pentru intelegerea contextului.", descriptionKey: "tutorial.dashboard.steps.regional.description", selector: '[data-tutorial="dashboard-regional-factors"]', placement: "top" },
    ],
  },
  {
    id: "map",
    title: "Map walkthrough",
    titleKey: "tutorial.map.title",
    description: "Pagina Map combina locatia ta, resursele apropiate si incidentele active intr-o singura vedere.",
    descriptionKey: "tutorial.map.description",
    routeMatcher: "/map",
    steps: [
      { title: "Map controls", titleKey: "tutorial.map.steps.controls.title", description: "Din headerul paginii poti centra harta pe pozitia ta si vezi imediat starea de lucru offline.", descriptionKey: "tutorial.map.steps.controls.description", selector: '[data-tutorial="map-tools"]', placement: "bottom" },
      { title: "Save your location", titleKey: "tutorial.map.steps.location.title", description: "Aici poti seta sau actualiza manual locatia salvata in cont sau pe dispozitiv.", descriptionKey: "tutorial.map.steps.location.description", selector: '[data-tutorial="map-save-location"]', placement: "bottom" },
      { title: "Resource filters", titleKey: "tutorial.map.steps.filters.title", description: "Filtrele iti permit sa ascunzi sau sa afisezi adaposturi, farmacii si spitale.", descriptionKey: "tutorial.map.steps.filters.description", selector: '[data-tutorial="map-filters"]', placement: "bottom" },
      { title: "Resource list", titleKey: "tutorial.map.steps.resources.title", description: "Lista din stanga te ajuta sa cauti si sa deschizi rapid resursele cele mai apropiate.", descriptionKey: "tutorial.map.steps.resources.description", selector: '[data-tutorial="map-resource-list"]', placement: "right" },
      { title: "Interactive map", titleKey: "tutorial.map.steps.canvas.title", description: "Harta afiseaza resurse, incidente si aria de acoperire din jurul pozitiei tale.", descriptionKey: "tutorial.map.steps.canvas.description", selector: '[data-tutorial="map-canvas"]', placement: "top" },
      { title: "Active incidents", titleKey: "tutorial.map.steps.incidents.title", description: "Panoul din dreapta iti da acces rapid la incidentele geolocalizate aflate in desfasurare.", descriptionKey: "tutorial.map.steps.incidents.description", selector: '[data-tutorial="map-incident-list"]', placement: "left" },
    ],
  },
  {
    id: "communication",
    title: "Communication walkthrough",
    titleKey: "tutorial.communication.title",
    description: "Hub-ul de comunicare uneste canalul global, mesajele private si raspunsurile rapide.",
    descriptionKey: "tutorial.communication.description",
    routeMatcher: "/communication",
    steps: [
      { title: "Channels", titleKey: "tutorial.communication.steps.channels.title", description: "Aici alegi intre canalul global si PM-urile cu utilizatorii online.", descriptionKey: "tutorial.communication.steps.channels.description", selector: '[data-tutorial="communication-channels"]', placement: "right" },
      { title: "Chat stream", titleKey: "tutorial.communication.steps.chat.title", description: "Zona centrala arata mesajele, reactiile si raspunsurile din canalul activ.", descriptionKey: "tutorial.communication.steps.chat.description", selector: '[data-tutorial="communication-chat"]', placement: "top" },
      { title: "Message input", titleKey: "tutorial.communication.steps.input.title", description: "Campul de jos este locul din care trimiti mesaje noi in canalul sau PM-ul curent.", descriptionKey: "tutorial.communication.steps.input.description", selector: '[data-tutorial="communication-input"]', placement: "top" },
      { title: "Quick updates", titleKey: "tutorial.communication.steps.quick.title", description: "Butoanele rapide sunt utile pentru confirmari scurte si mesaje standardizate.", descriptionKey: "tutorial.communication.steps.quick.description", selector: '[data-tutorial="communication-quick"]', placement: "left" },
    ],
  },
  {
    id: "education",
    title: "Education walkthrough",
    titleKey: "tutorial.education.title",
    description: "Education organizeaza materialele pe clase, materii si manuale pregatite pentru preview.",
    descriptionKey: "tutorial.education.description",
    routeMatcher: "/education",
    steps: [
      { title: "Grade selector", titleKey: "tutorial.education.steps.grades.title", description: "Alege clasa din care vrei sa navighezi continutul educational.", descriptionKey: "tutorial.education.steps.grades.description", selector: '[data-tutorial="education-grades"]', placement: "right" },
      { title: "Subjects", titleKey: "tutorial.education.steps.subjects.title", description: "Dupa selectarea clasei, aici vezi materiile disponibile pentru acea grupa.", descriptionKey: "tutorial.education.steps.subjects.description", selector: '[data-tutorial="education-subjects"]', placement: "bottom" },
      { title: "Manuals", titleKey: "tutorial.education.steps.manuals.title", description: "Lista de manuale si preview-ul sunt pregatite pentru vizualizare si extindere ulterioara.", descriptionKey: "tutorial.education.steps.manuals.description", selector: '[data-tutorial="education-manuals"]', placement: "left" },
    ],
  },
  {
    id: "guide",
    title: "Guide walkthrough",
    titleKey: "tutorial.guide.title",
    description: "Guide este zona in care organizezi PDF-uri operationale si materiale de lucru pe categorii.",
    descriptionKey: "tutorial.guide.description",
    routeMatcher: "/guide",
    steps: [
      { title: "Search", titleKey: "tutorial.guide.steps.search.title", description: "Cautarea filtreaza rapid lectiile si situatiile din categoria selectata.", descriptionKey: "tutorial.guide.steps.search.description", selector: '[data-tutorial="guide-search"]', placement: "bottom" },
      { title: "Categories", titleKey: "tutorial.guide.steps.categories.title", description: "Panoul din stanga schimba domeniul si subcategoria pe care o inspectezi.", descriptionKey: "tutorial.guide.steps.categories.description", selector: '[data-tutorial="guide-categories"]', placement: "right" },
      { title: "Upload panel", titleKey: "tutorial.guide.steps.upload.title", description: "Aici incarci sau inlocuiesti PDF-uri pentru subcategoriile existente.", descriptionKey: "tutorial.guide.steps.upload.description", selector: '[data-tutorial="guide-upload"]', placement: "right" },
      { title: "Preview and actions", titleKey: "tutorial.guide.steps.details.title", description: "Zona principala permite preview, redenumire, stergere si adaugare de subcategorii.", descriptionKey: "tutorial.guide.steps.details.description", selector: '[data-tutorial="guide-details"]', placement: "left" },
    ],
  },
  {
    id: "incident-details",
    title: "Incident Details walkthrough",
    titleKey: "tutorial.incidentDetails.title",
    description: "Pagina detaliata a incidentului concentreaza taskurile, comanda si istoricul operational.",
    descriptionKey: "tutorial.incidentDetails.description",
    routeMatcher: /^\/incidents\/[^/]+$/,
    steps: [
      { title: "Incident overview", titleKey: "tutorial.incidentDetails.steps.overview.title", description: "Partea de sus explica pe scurt situatia curenta si indicatorii principali.", descriptionKey: "tutorial.incidentDetails.steps.overview.description", selector: '[data-tutorial="incident-details-overview"]', placement: "bottom" },
      { title: "Tasks", titleKey: "tutorial.incidentDetails.steps.tasks.title", description: "Aici vezi checklist-ul operational si poti adauga sau actualiza taskuri.", descriptionKey: "tutorial.incidentDetails.steps.tasks.description", selector: '[data-tutorial="incident-details-tasks"]', placement: "right" },
      { title: "Command panel", titleKey: "tutorial.incidentDetails.steps.command.title", description: "Panoul de comanda modifica statusul, severitatea si raza incidentului.", descriptionKey: "tutorial.incidentDetails.steps.command.description", selector: '[data-tutorial="incident-details-command"]', placement: "left" },
      { title: "Assignments and guides", titleKey: "tutorial.incidentDetails.steps.guides.title", description: "Aceasta zona arata cine este asignat si ce ghiduri sunt deja legate de incident.", descriptionKey: "tutorial.incidentDetails.steps.guides.description", selector: '[data-tutorial="incident-details-guides"]', placement: "left" },
      { title: "Operational timeline", titleKey: "tutorial.incidentDetails.steps.timeline.title", description: "Timeline-ul iti ofera istoricul actiunilor si al schimbarilor importante.", descriptionKey: "tutorial.incidentDetails.steps.timeline.description", selector: '[data-tutorial="incident-details-timeline"]', placement: "top" },
    ],
  },
  {
    id: "operations-tasks",
    title: "Operations Tasks walkthrough",
    titleKey: "tutorial.operationsTasks.title",
    description: "Vedere agregata pentru taskurile din toate incidentele active.",
    descriptionKey: "tutorial.operationsTasks.description",
    routeMatcher: "/operations/tasks",
    steps: [
      { title: "Tasks summary", titleKey: "tutorial.operationsTasks.steps.summary.title", description: "Headerul iti arata totalul taskurilor si distributia lor pe stari.", descriptionKey: "tutorial.operationsTasks.steps.summary.description", selector: '[data-tutorial="operations-tasks-summary"]', placement: "bottom" },
      { title: "Aggregated tasks", titleKey: "tutorial.operationsTasks.steps.list.title", description: "Lista centrala iti permite sa schimbi rapid statusul fiecarui task.", descriptionKey: "tutorial.operationsTasks.steps.list.description", selector: '[data-tutorial="operations-tasks-list"]', placement: "top" },
    ],
  },
  {
    id: "notifications",
    title: "Notifications walkthrough",
    titleKey: "tutorial.notifications.title",
    description: "Aici se centralizeaza alertele operationale, asignarile si incidentele importante.",
    descriptionKey: "tutorial.notifications.description",
    routeMatcher: "/notifications",
    steps: [
      { title: "Notifications summary", titleKey: "tutorial.notifications.steps.summary.title", description: "Cardul introductiv explica tipul de evenimente pe care il gasesti in acest flux.", descriptionKey: "tutorial.notifications.steps.summary.description", selector: '[data-tutorial="notifications-summary"]', placement: "bottom" },
      { title: "Notifications list", titleKey: "tutorial.notifications.steps.list.title", description: "Lista de jos iti permite sa deschizi rapid notificarile care au link catre alte pagini.", descriptionKey: "tutorial.notifications.steps.list.description", selector: '[data-tutorial="notifications-list"]', placement: "top" },
    ],
  },
  {
    id: "training",
    title: "Training walkthrough",
    titleKey: "tutorial.training.title",
    description: "Training & Drill History urmareste sabloanele de simulare si istoricul finalizarilor.",
    descriptionKey: "tutorial.training.description",
    routeMatcher: "/training",
    steps: [
      { title: "Drill templates", titleKey: "tutorial.training.steps.templates.title", description: "Din stanga pornesti rapid o simulare si o marchezi ca finalizata.", descriptionKey: "tutorial.training.steps.templates.description", selector: '[data-tutorial="training-templates"]', placement: "right" },
      { title: "History", titleKey: "tutorial.training.steps.history.title", description: "Panoul din dreapta pastreaza istoricul ultimelor exercitii finalizate.", descriptionKey: "tutorial.training.steps.history.description", selector: '[data-tutorial="training-history"]', placement: "left" },
    ],
  },
  {
    id: "ai-assist",
    title: "AI Assist walkthrough",
    titleKey: "tutorial.safety.title",
    description: "Emergency Copilot te ajuta sa descrii o situatie si sa primesti pasi practici.",
    descriptionKey: "tutorial.safety.description",
    routeMatcher: "/safety",
    steps: [
      { title: "Emergency Copilot", titleKey: "tutorial.safety.steps.members.title", description: "Aici scrii liber o situatie de urgenta sau o intrebare generala.", descriptionKey: "tutorial.safety.steps.members.description", selector: '[data-tutorial="communication-ai"]', placement: "top" },
    ],
  },
  {
    id: "sos",
    title: "SOS walkthrough",
    titleKey: "tutorial.sos.title",
    description: "SOS Emergency te ajuta sa trimiti alerta, sa creezi incident si sa urmaresti coordonarea.",
    descriptionKey: "tutorial.sos.description",
    routeMatcher: "/sos",
    steps: [
      { title: "SOS trigger", titleKey: "tutorial.sos.steps.trigger.title", description: "Butonul mare porneste fluxul de urgenta si deschide confirmarea de trimitere.", descriptionKey: "tutorial.sos.steps.trigger.description", selector: '[data-tutorial="sos-trigger"]', placement: "right" },
      { title: "Message and context", titleKey: "tutorial.sos.steps.message.title", description: "Poti adauga un mesaj personalizat si vezi imediat incidentul creat automat.", descriptionKey: "tutorial.sos.steps.message.description", selector: '[data-tutorial="sos-message"]', placement: "bottom" },
      { title: "Emergency contacts", titleKey: "tutorial.sos.steps.contacts.title", description: "Zona aceasta grupeaza contactele apelabile si legatura cu profilul tau.", descriptionKey: "tutorial.sos.steps.contacts.description", selector: '[data-tutorial="sos-contacts"]', placement: "top" },
      { title: "Family alerts", titleKey: "tutorial.sos.steps.alerts.title", description: "Aici vezi alertele recente venite din familie sau din testele operationale.", descriptionKey: "tutorial.sos.steps.alerts.description", selector: '[data-tutorial="sos-alerts"]', placement: "top" },
    ],
  },
  {
    id: "profile-settings",
    title: "Profile Settings walkthrough",
    titleKey: "tutorial.profileSettings.title",
    description: "Pagina de profil iti gestioneaza starea de autentificare si personalizarea contului.",
    descriptionKey: "tutorial.profileSettings.description",
    routeMatcher: "/profile-settings",
    steps: [
      { title: "Profile state", titleKey: "tutorial.profileSettings.steps.state.title", description: "Primul card explica daca esti in guest mode sau logat cu un cont activ.", descriptionKey: "tutorial.profileSettings.steps.state.description", selector: '[data-tutorial="profile-state"]', placement: "bottom" },
      { title: "Account details", titleKey: "tutorial.profileSettings.steps.account.title", description: "Aici vezi informatiile de baza ale contului si identitatea salvata local.", descriptionKey: "tutorial.profileSettings.steps.account.description", selector: '[data-tutorial="profile-account"]', placement: "bottom" },
      { title: "Profile picture", titleKey: "tutorial.profileSettings.steps.picture.title", description: "Sectiunea de poza iti permite selectia fisierului, preview si upload.", descriptionKey: "tutorial.profileSettings.steps.picture.description", selector: '[data-tutorial="profile-picture"]', placement: "top" },
    ],
  },
];

function matchesRoute(matcher, pathname) {
  if (typeof matcher === "string") {
    return matcher === pathname;
  }
  if (matcher instanceof RegExp) {
    return matcher.test(pathname);
  }
  if (typeof matcher === "function") {
    return Boolean(matcher(pathname));
  }
  return false;
}

export function resolveTutorialDefinition(pathname) {
  return TUTORIALS.find((tutorial) => matchesRoute(tutorial.routeMatcher, pathname)) || null;
}

export default TUTORIALS;
