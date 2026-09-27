<%*
const rv = await tp.user.newRv(tp);
-%>
---
Address: "<% rv.addressYaml %>"
Priority: 0
Met: "<% rv.created %>"
Last Spoke: "<% rv.created %>"
Last Attempted: "<% rv.created %>"
Met With:
Taken:
Visits: 1
Successful Visits: 1
icon: door-open
color: purple
Hub:
  - "[[Return Visits Hub]]"
cssclasses:
  - "hide-props"
  - "rv-dashboard"
---
> Hubs: `INPUT[inlineListSuggester(optionQuery("")):Hub]`
> Address: `INPUT[text:Address]` [🗺️](<% rv.mapUrl %>)

> [!rv]- 👤 RV Dashboard
>
> **Priority**
> `INPUT[slider(minValue(0), maxValue(5)):Priority]` `VIEW[{Priority}]`
>
> **Visits**
> `INPUT[number:Visits]`
>
> **Successful Visits**
> `INPUT[number:["Successful Visits"]]`
>
> **Met**
> `INPUT[dateTime:["Met"]]`
>
> **Last Spoke**
> `INPUT[dateTime:["Last Spoke"]]`
>
> **Last Attempted**
> `INPUT[dateTime:["Last Attempted"]]`
>
> **Met With**
> `INPUT[text:["Met With"]]`
>
> **Taken**
> `INPUT[inlineList:Taken]`

---

**Log visit**

`BUTTON[rv-log-home, rv-log-miss]`

```meta-bind-button
label: Home
style: primary
id: rv-log-home
hidden: true
actions:
  - type: runTemplaterFile
    templateFile: Templates/RV Log Home.md
```

```meta-bind-button
label: Not home
style: default
id: rv-log-miss
hidden: true
actions:
  - type: runTemplaterFile
    templateFile: Templates/RV Log Miss.md
```

### <% rv.stamp %>

> [!note]- Attempt Log
> - <% rv.stamp %> — success
