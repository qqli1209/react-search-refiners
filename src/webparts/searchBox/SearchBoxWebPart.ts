import * as React from 'react';
import * as ReactDom from 'react-dom';
import { Version, Environment, Text, EnvironmentType } from '@microsoft/sp-core-library';
import {
  BaseClientSideWebPart,
  IPropertyPaneConfiguration,
  PropertyPaneTextField,
  IPropertyPaneField,
  PropertyPaneCheckbox,
  PropertyPaneDropdown,
  PropertyPaneToggle,
  PropertyPaneLabel,
  IWebPartPropertiesMetadata,
  PropertyPaneHorizontalRule,
  PropertyPaneDynamicFieldSet,
  PropertyPaneDynamicField,
  DynamicDataSharedDepth
} from '@microsoft/sp-webpart-base';
import * as strings from 'SearchBoxWebPartStrings';
import ISearchBoxWebPartProps from './ISearchBoxWebPartProps';
import { IDynamicDataCallables, IDynamicDataPropertyDefinition } from '@microsoft/sp-dynamic-data';
import ISearchQuery from '../../models/ISearchQuery';
import { ISearchBoxContainerProps } from './components/SearchBoxContainer/ISearchBoxContainerProps';
import ServiceHelper from '../../helpers/ServiceHelper';
import ISearchService from '../../services/SearchService/ISearchService';
import INlpService from '../../services/NlpService/INlpService';
import MockSearchService from '../../services/SearchService/MockSearchService';
import SearchService from '../../services/SearchService/SearchService';
import MockNlpService from '../../services/NlpService/MockNlpService';
import NlpService from '../../services/NlpService/NlpService';
import { PageOpenBehavior } from '../../helpers/UrlHelper';
import SearchBoxContainer from './components/SearchBoxContainer/SearchBoxContainer';
import { SearchComponentType } from '../../models/SearchComponentType';

// 每个 dynamic data source 都要实现 IDynamicDataCallables 接口
export default class SearchBoxWebPart extends BaseClientSideWebPart<ISearchBoxWebPartProps> implements IDynamicDataCallables {
  private _searchQuery: ISearchQuery;
  private _searchService: ISearchService;
  private _serviceHelper: ServiceHelper;
  private _nlpService: INlpService;

  constructor() {
    super();

    // Initialize default values for search query
    this._searchQuery = {
      rawInputValue: '',
      enhancedQuery: ''
    };

    this._bindHashChange = this._bindHashChange.bind(this);
  }

  // 把自己注册成为 dynamic data source
  protected onInit(): Promise<void> {
    this._serviceHelper = new ServiceHelper(this.context.httpClient);
    this.context.dynamicDataSourceManager.initializeSource(this);
    
    this.initSearchService();
    this.initNlpService();

    this._bindHashChange();

    return Promise.resolve();
  }

  // 通知 data consumer 自己的 properties 变了
  private _onSearch = (searchQuery: ISearchQuery): void => {

    this._searchQuery = searchQuery;
    this.context.dynamicDataSourceManager.notifyPropertyChanged('searchQuery');
  }

  public render(): void {

    let inputValue = this.properties.defaultQueryKeywords.tryGetValue();

    if (inputValue && typeof(inputValue) === 'string') {
      this._searchQuery.rawInputValue = decodeURIComponent(inputValue);
      this.context.dynamicDataSourceManager.notifyPropertyChanged('searchQuery');
    }
    
    const element: React.ReactElement<ISearchBoxContainerProps> = React.createElement(
      SearchBoxContainer, { 
        onSearch: this._onSearch,
        searchInNewPage: this.properties.searchInNewPage,
        pageUrl: this.properties.pageUrl,
        openBehavior: this.properties.openBehavior,
        inputValue: this._searchQuery.rawInputValue,
        enableQuerySuggestions: this.properties.enableQuerySuggestions,
        searchService: this._searchService,
        enableDebugMode: this.properties.enableDebugMode,
        enableNlpService: this.properties.enableNlpService,
        isStaging: this.properties.isStaging,
        NlpService: this._nlpService,
        placeholderText: this.properties.placeholderText,
        domElement: this.domElement
      } as ISearchBoxContainerProps);

    ReactDom.render(element, this.domElement);
  }

  public getPropertyDefinitions(): ReadonlyArray<IDynamicDataPropertyDefinition> {
    return [
      {
          id: SearchComponentType.SearchBoxWebPart,
          title: strings.DynamicData.SearchQueryPropertyLabel
      },
    ];
  }

  public getAnnotatedPropertyValue(propertyId: string) {

      switch (propertyId) {

          case 'searchQuery':
          
              const annotatedPropertyValue = {
                  sampleValue: {
                      'rawInputValue': "*",
                      'enhancedQuery': '(rawQuery) XRANK(cb=500) owsTaxIdrawQuery:5eb0b270-f8ce-42e9-866f-73b1466a26ac',
                  },
                  metadata: {
                      'rawInputValue': { title: strings.DynamicData.RawInputValuePropertyLabel},
                      'enhancedQuery': { title: strings.DynamicData.EnhancedQueryPropertyLabel },
                  }
              };

              return annotatedPropertyValue;

          default:
              throw new Error('Bad property id');
      }
  }

  public getPropertyValue(propertyId: string) {
        
    switch (propertyId) {

        case 'searchQuery':
            return this._searchQuery;

        default:
            throw new Error('Bad property id');
    }
  }

  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [
        {
          groups: [
            {
              groupName: strings.SearchBoxQuerySettings,
              groupFields: this._getSearchQueryFields()
            },
            {
              groupName: strings.SearchBoxNewPage,
              groupFields: this._getSearchBehaviorOptionsFields()
            },
            {
                groupName: strings.SearchBoxQueryNlpSettings,
                groupFields: this._getSearchQueryOptimizationFields()
            },
          ],
          displayGroupsAsAccordion: true
        }
      ]
    };
  }

  protected onPropertyPaneFieldChanged(propertyPath: string) {
    this.initSearchService();
    this.initNlpService();

    if (!this.properties.useDynamicDataSource) {
      this.properties.defaultQueryKeywords.setValue("");
    } else {
        this._bindHashChange();
    }

    if (propertyPath === 'enableNlpService') {
      this.properties.enableDebugMode = !this.properties.enableDebugMode ? false : true;
    }
  }

  protected onDispose(): void {
    ReactDom.unmountComponentAtNode(this.domElement);
  }

  private _validatePageUrl(value: string) {    
    
    if ((!/^(https?):\/\/[^\s/$.?#].[^\s]*/.test(value) || !value) && this.properties.searchInNewPage) {
      return strings.SearchBoxUrlErrorMessage;
    }
    
    return '';
  }

  private async _validateServiceUrl(value: string) {

    if ((!/^(https?):\/\/[^\s/$.?#].[^\s]*/.test(value) || !value)) {
      return strings.SearchBoxUrlErrorMessage;
    } else {
      if (Environment.type !== EnvironmentType.Local) {
        try {
          await this._serviceHelper.ensureUrlResovles(value);
          return '';
        } catch (errorMessage) {
            return Text.format(strings.UrlNotResolvedErrorMessage, value, errorMessage);
        }
      } else {
        return '';
      }
    }
  }

  private initSearchService() {
      
      if (this.properties.enableQuerySuggestions) {
        if (Environment.type === EnvironmentType.Local ) {
          this._searchService = new MockSearchService();
        } else {
          this._searchService = new SearchService(this.context.pageContext, this.context.spHttpClient);        
        return "";
      }
    }
  }

  private initNlpService() {

    if (this.properties.enableNlpService && this.properties.NlpServiceUrl) {
        if (Environment.type === EnvironmentType.Local) {
            this._nlpService = new MockNlpService();
            this.properties.NlpServiceUrl = 'https://localhost:7071/api/example';
        } else {
            this._nlpService = new NlpService(this.context, this.properties.NlpServiceUrl);
        }
    }
  }

  protected get propertiesMetadata(): IWebPartPropertiesMetadata {
    return {
      'defaultQueryKeywords': {
        dynamicPropertyType: 'string'
      }
    };
  }

  private _getSearchQueryFields(): IPropertyPaneField<any>[] {
      
    // Sets up search query fields
    let searchQueryConfigFields: IPropertyPaneField<any>[] = [
        PropertyPaneCheckbox('useDynamicDataSource', {
            checked: false,
            text: strings.DynamicData.UseDynamicDataSourceLabel,
        })
    ];

    if (this.properties.useDynamicDataSource) {
      searchQueryConfigFields.push(
        PropertyPaneDynamicFieldSet({
          label: strings.DynamicData.DefaultQueryKeywordsPropertyLabel,
          fields: [
            PropertyPaneDynamicField('defaultQueryKeywords', {
              label: strings.DynamicData.DefaultQueryKeywordsPropertyLabel,
            })
          ],          
          sharedConfiguration: {
            depth: DynamicDataSharedDepth.Source,
          }
        })
      );
    }

    return searchQueryConfigFields;
}

  private _getSearchBehaviorOptionsFields(): IPropertyPaneField<any>[] {

    let searchBehaviorOptionsFields: IPropertyPaneField<any>[]  = [
      PropertyPaneToggle("enableQuerySuggestions", {
        checked: false,
        label: strings.SearchBoxEnableQuerySuggestions
      }),
      PropertyPaneHorizontalRule(),
      PropertyPaneCheckbox('searchInNewPage', {
        text: strings.SearchBoxSearchInNewPageLabel
      }),
      PropertyPaneHorizontalRule(),
      PropertyPaneTextField('placeholderText', {
        label: strings.SearchBoxPlaceholderTextLabel
      })
    ];

    if (this.properties.searchInNewPage) {
      searchBehaviorOptionsFields = searchBehaviorOptionsFields.concat([
        PropertyPaneTextField('pageUrl', {
          disabled: !this.properties.searchInNewPage,
          label: strings.SearchBoxPageUrlLabel,
          onGetErrorMessage: this._validatePageUrl.bind(this)
        }),
        PropertyPaneDropdown('openBehavior', {
          label:  strings.SearchBoxPageOpenBehaviorLabel,
          options: [
            { key: PageOpenBehavior.Self, text: strings.SearchBoxSameTabOpenBehavior, index: 0 },
            { key: PageOpenBehavior.NewTab, text: strings.SearchBoxNewTabOpenBehavior, index: 1 }
          ],
          disabled:  !this.properties.searchInNewPage,
          selectedKey: 0
        })
      ]);
    }

    return searchBehaviorOptionsFields;
  }

  private _getSearchQueryOptimizationFields(): IPropertyPaneField<any>[] {

      let searchQueryOptimizationFields: IPropertyPaneField<any>[] = [
          PropertyPaneLabel("", {
              text: strings.SearchBoxQueryNlpSettingsDescription
          }),
          PropertyPaneToggle("enableNlpService", {
              checked: false,
              label: strings.SearchBoxUserQueryNlpLabel,
          })
      ];

      if (this.properties.enableNlpService) {

          searchQueryOptimizationFields.push(
              PropertyPaneTextField("NlpServiceUrl", {
                  label: strings.SearchBoxServiceUrlLabel,
                  disabled: !this.properties.enableNlpService,
                  onGetErrorMessage: this._validateServiceUrl.bind(this),
                  description: Text.format(strings.SearchBoxServiceUrlDescription, window.location.host)
              }),
              PropertyPaneToggle("enableDebugMode", {
                  checked: false,
                  label: strings.SearchBoxUseDebugModeLabel,
                  disabled: !this.properties.enableNlpService,
              }),
              PropertyPaneToggle("isStaging", {
                checked: true,
                label: strings.SearchBoxUseStagingEndpoint,
                disabled: !this.properties.enableNlpService,
            }),
          );
      } else {
          this.properties.enableDebugMode = false;
      }

      return searchQueryOptimizationFields;
  }

  private _bindHashChange() {

    if (this.properties.defaultQueryKeywords.tryGetSource()) {
        if (this.properties.defaultQueryKeywords.reference.localeCompare('PageContext:UrlData:fragment') === 0) {
            // Manually subscribe to hash change since the default property doesn't
            window.addEventListener('hashchange', this.render);
        } else {
            window.removeEventListener('hashchange', this.render); 
        }
    }
  }
}
