// src/pages/HoverTabsPage.jsx
import { useState } from "react";
import "../styles/HoverTabs.css"; // vom crea CSS-ul

const HoverTabsPage = () => {
  const [activeTab, setActiveTab] = useState("London");

  const tabs = [
    {
      id: "London",
      title: "London",
      content:
        "London is the capital city of England. It is the most populous city in the United Kingdom, with a metropolitan area of over 13 million inhabitants.",
    },
    {
      id: "Paris",
      title: "Paris",
      content:
        'Paris is the capital and most populous city of France. Known as the "City of Light", it is famous for art, fashion, gastronomy and culture.',
    },
    {
      id: "Tokyo",
      title: "Tokyo",
      content:
        "Tokyo is the capital of Japan and one of the world's most populous cities. It is a fascinating blend of traditional culture and cutting-edge technology.",
    },
    {
      id: "Bucharest",
      title: "București",
      content:
        "București este capitala României, un oraș vibrant cu istorie bogată, arhitectură impresionantă și viață de noapte animată.",
    },
  ];

  return (
    <div className="hover-tabs-container">
      <h1>Hover Tabs Verticale</h1>
      <p>Trece cu mouse-ul peste tab-uri pentru a vedea conținutul!</p>

      <div className="tab-wrapper">
        {/* Tab-urile verticale */}
        <div className="tab">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tablinks ${activeTab === tab.id ? "active" : ""}`}
              onMouseEnter={() => setActiveTab(tab.id)}
            >
              {tab.title}
            </button>
          ))}
        </div>

        {/* Conținutul tab-urilor */}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            id={tab.id}
            className="tabcontent"
            style={{ display: activeTab === tab.id ? "block" : "none" }}
          >
            <h3>{tab.title}</h3>
            <p>{tab.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default HoverTabsPage;
